import { Prisma } from '@prisma/client';
import { prisma } from '@/app/lib/prisma';
import {
  checkStationTypeIds,
  createReferenceImageRows,
  parseReferenceImageUploads,
  parseReferenceWeight,
  registerReferenceImages,
  removeReferenceImageObjects,
  stationTypeIdOf,
  verifyReferenceImageUploads,
  type ReferenceImageUpload,
  type VerifiedReferenceImage,
} from '@/lib/reference-items';

/**
 * Saving a reference item from the settings dialog — POST (new) and PUT
 * (edit) of /api/settings/reference-items share it.
 *
 * Body (JSON):
 *   item_type_id, manufacturer_sku, manufacturer, name?, reference_weight?
 *   (grams), notes?, images (NEW uploads, already in MinIO through
 *   images/presign, each with its stationTypeId), keepImageIds? (edit: existing
 *   image ids to keep; absent = keep all), imageStations? (edit: { "<existing
 *   image id>": stationTypeId } — an image moved to another station, or an
 *   unassigned one given its station), primaryKey? ("<existingImageId>" |
 *   "new:<index>") or primaryIndex? (index into images)
 *   members?  package types only: the package reference's members, one per
 *             content line — [{ item_type_id, reference_item_id? (an existing
 *             member), ...the same fields as above }]. A member left out is
 *             deleted with its images; `members` absent leaves them as they are.
 *
 * Everything is checked first — every field, every member, every upload — and
 * nothing is written unless it all passes. The rows are then written in one
 * transaction; the image bytes of what was dropped leave the RU bucket, and
 * the new images' registry rows are activated, only after it commits.
 */

export class ReferenceSaveError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

type Raw = Record<string, unknown>;

/** One reference item's form: the item itself, or one of its members. */
type ItemForm = {
  manufacturerSku: string;
  manufacturer: string;
  name: string | null;
  weight: string | null;
  notes: string | null;
  uploads: ReferenceImageUpload[];
  /** null = keep every existing image. */
  keepImageIds: number[] | null;
  /** Existing image id → the station type it moves to. */
  imageStations: Map<number, number>;
  /** "<existingImageId>" | "new:<index>" | "" */
  primaryKey: string;
};

type MemberForm = ItemForm & { itemTypeId: number; typeDesc: string; id: number | null };

const str = (v: unknown): string => (v == null ? '' : String(v)).trim();
const isObj = (v: unknown): v is Raw => !!v && typeof v === 'object' && !Array.isArray(v);

/** `who` prefixes every message about a member ("מחשב: …"). */
function parseItemForm(raw: Raw, who: string): ItemForm {
  const fail = (msg: string) => new ReferenceSaveError(who ? `${who}: ${msg}` : msg);
  const manufacturerSku = str(raw.manufacturer_sku);
  const manufacturer = str(raw.manufacturer);
  if (!manufacturerSku) throw fail('יש להזין מק״ט יצרן.');
  if (!manufacturer) throw fail('יש להזין יצרן.');
  const weight = parseReferenceWeight(str(raw.reference_weight));
  if (!weight.ok) throw fail(weight.error);
  let uploads: ReferenceImageUpload[];
  try {
    uploads = parseReferenceImageUploads(raw.images);
  } catch (e) {
    throw fail(e instanceof Error ? e.message : 'רשימת התמונות אינה תקינה');
  }
  const imageStations = new Map<number, number>();
  if (raw.imageStations != null) {
    if (!isObj(raw.imageStations)) throw fail('שיוך התמונות לעמדות אינו תקין');
    for (const [imageId, station] of Object.entries(raw.imageStations)) {
      const stationTypeId = stationTypeIdOf(station);
      if (!/^\d+$/.test(imageId) || stationTypeId == null) throw fail('שיוך התמונות לעמדות אינו תקין');
      imageStations.set(Number(imageId), stationTypeId);
    }
  }
  const primaryIndex = raw.primaryIndex;
  return {
    manufacturerSku,
    manufacturer,
    name: str(raw.name) || null,
    weight: weight.value,
    notes: str(raw.notes) || null,
    uploads,
    keepImageIds: Array.isArray(raw.keepImageIds) ? raw.keepImageIds.map(Number).filter(Number.isFinite) : null,
    imageStations,
    primaryKey: str(raw.primaryKey) || (primaryIndex != null && primaryIndex !== '' ? `new:${Number(primaryIndex)}` : ''),
  };
}

type ExistingImage = { reference_item_image_id: number; object_key: string; sort_order: number };
type Existing = { reference_item_id: number; primary_image_id: number | null; images: ExistingImage[] };

/** What one item's save does to its images. */
type ImagePlan = { keep: number[]; drop: ExistingImage[]; startSort: number };

function planImages(existing: Existing | null, form: ItemForm): ImagePlan {
  const images = existing?.images ?? [];
  const keep = form.keepImageIds == null
    ? images.map((i) => i.reference_item_image_id)
    : images.map((i) => i.reference_item_image_id).filter((id) => form.keepImageIds!.includes(id));
  return {
    keep,
    drop: images.filter((i) => !keep.includes(i.reference_item_image_id)),
    startSort: images.reduce((m, i) => Math.max(m, i.sort_order), -1) + 1,
  };
}

/** The cover: the chosen image, else the surviving cover, else any image. */
function resolvePrimary(existing: Existing | null, plan: ImagePlan, newRows: { reference_item_image_id: number }[], primaryKey: string): number | null {
  if (primaryKey.startsWith('new:')) {
    const row = newRows[Number(primaryKey.slice(4))];
    if (row) return row.reference_item_image_id;
  } else if (primaryKey) {
    const asId = Number(primaryKey);
    if (plan.keep.includes(asId)) return asId;
  }
  const surviving = existing?.primary_image_id != null && plan.keep.includes(existing.primary_image_id) ? existing.primary_image_id : null;
  return surviving ?? plan.keep[0] ?? newRows[0]?.reference_item_image_id ?? null;
}

/** The kept images the form moved to another station (an image of another item is never touched). */
async function moveImages(tx: Prisma.TransactionClient, plan: ImagePlan, form: ItemForm): Promise<void> {
  for (const [imageId, stationTypeId] of form.imageStations) {
    if (!plan.keep.includes(imageId)) continue;
    await tx.reference_item_images.update({ where: { reference_item_image_id: imageId }, data: { test_station_type_id: stationTypeId } });
  }
}

const fieldsOf = (f: ItemForm) => ({
  manufacturer_sku: f.manufacturerSku,
  manufacturer: f.manufacturer,
  name: f.name,
  reference_weight: f.weight,
  notes: f.notes,
});

/** Save a reference item (id = null: create). Returns its id. Throws ReferenceSaveError. */
export async function saveReferenceItem(id: number | null, body: Raw): Promise<number> {
  const itemTypeId = Number(body.item_type_id);
  if (!itemTypeId || !Number.isFinite(itemTypeId)) throw new ReferenceSaveError('יש לבחור סוג פריט.');
  const itemType = await prisma.item_types.findUnique({ where: { item_type_id: itemTypeId } });
  if (!itemType) throw new ReferenceSaveError('סוג הפריט לא נמצא.');
  const form = parseItemForm(body, '');

  const existing = id == null ? null : await prisma.reference_items.findUnique({
    where: { reference_item_id: id },
    include: { images: true, members: { include: { images: true } } },
  });
  if (id != null && !existing) throw new ReferenceSaveError('פריט הייחוס לא נמצא', 404);
  if (existing?.parent_reference_id != null) {
    throw new ReferenceSaveError('פריט הייחוס הזה נמצא בתוך ייחוס מארז, ועורכים אותו מתוך ייחוס המארז.');
  }

  // ---- members ---------------------------------------------------------------
  const existingMembers = existing?.members ?? [];
  const sendsMembers = Array.isArray(body.members);
  const rawMembers = sendsMembers ? (body.members as unknown[]) : [];
  if (!itemType.is_package && (rawMembers.length > 0 || (!sendsMembers && existingMembers.length > 0))) {
    throw new ReferenceSaveError(existingMembers.length > 0
      ? 'לא ניתן לשנות לסוג שאינו מארז ייחוס מארז שיש בו פריטי ייחוס. הסר קודם את הפריטים.'
      : 'רק לייחוס של סוג מארז יש פריטי ייחוס בתכולה.');
  }
  const memberTypeIds = rawMembers.map((m) => (isObj(m) ? Number(m.item_type_id) : NaN));
  if (memberTypeIds.some((t) => !t || !Number.isFinite(t))) throw new ReferenceSaveError('לכל פריט בתכולה צריך סוג פריט.');
  if (new Set(memberTypeIds).size !== memberTypeIds.length) throw new ReferenceSaveError('יש בתכולה שני פריטי ייחוס מאותו סוג.');
  const memberTypes = memberTypeIds.length === 0 ? [] : await prisma.item_types.findMany({ where: { item_type_id: { in: memberTypeIds } } });
  const members: MemberForm[] = rawMembers.map((raw, i) => {
    const type = memberTypes.find((t) => t.item_type_id === memberTypeIds[i]);
    if (!type) throw new ReferenceSaveError('סוג הפריט של פריט בתכולה לא נמצא.');
    const typeDesc = type.item_type_desc.trim();
    if (type.is_package) throw new ReferenceSaveError(`${typeDesc}: סוג מארז לא יכול להיות בתכולה של מארז.`);
    const r = raw as Raw;
    const memberId = r.reference_item_id != null && r.reference_item_id !== '' ? Number(r.reference_item_id) : null;
    if (memberId != null && !existingMembers.some((m) => m.reference_item_id === memberId && m.item_type_id === type.item_type_id)) {
      throw new ReferenceSaveError(`${typeDesc}: פריט הייחוס לא נמצא בייחוס המארז הזה.`);
    }
    return { ...parseItemForm(r, typeDesc), itemTypeId: type.item_type_id, typeDesc, id: memberId };
  });

  // ---- uploads: verified before anything is written ----------------------------
  const verify = async (f: ItemForm, who: string): Promise<VerifiedReferenceImage[]> => {
    try {
      await checkStationTypeIds([...f.imageStations.values()]);
      return await verifyReferenceImageUploads(f.uploads);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'תמונה לא תקינה';
      throw new ReferenceSaveError(who ? `${who}: ${msg}` : msg);
    }
  };
  const verified = await verify(form, '');
  const memberVerified: VerifiedReferenceImage[][] = [];
  for (const m of members) memberVerified.push(await verify(m, m.typeDesc));

  // ---- the plan --------------------------------------------------------------
  const plan = planImages(existing, form);
  const memberPlans = members.map((m) => {
    const prev = m.id == null ? null : existingMembers.find((x) => x.reference_item_id === m.id)!;
    return { prev, plan: planImages(prev, m) };
  });
  const removedMembers = sendsMembers
    ? existingMembers.filter((x) => !members.some((m) => m.id === x.reference_item_id))
    : [];

  // ---- write -----------------------------------------------------------------
  let refId = id;
  const registrations: { id: number; images: VerifiedReferenceImage[] }[] = [];
  try {
    refId = await prisma.$transaction(async (tx) => {
      const ownId = id ?? (await tx.reference_items.create({
        data: { item_type_id: itemTypeId, ...fieldsOf(form) },
        select: { reference_item_id: true },
      })).reference_item_id;

      // Dropped first: a member removed and another of its type added in the
      // same save must not meet it on the (parent, type) unique index.
      const dropIds = [...plan.drop, ...memberPlans.flatMap((p) => p.plan.drop)].map((i) => i.reference_item_image_id);
      if (dropIds.length > 0) await tx.reference_item_images.deleteMany({ where: { reference_item_image_id: { in: dropIds } } });
      if (removedMembers.length > 0) {
        await tx.reference_items.deleteMany({ where: { reference_item_id: { in: removedMembers.map((m) => m.reference_item_id) } } });
      }

      await moveImages(tx, plan, form);
      const newRows = await createReferenceImageRows(tx, ownId, verified, plan.startSort);
      await tx.reference_items.update({
        where: { reference_item_id: ownId },
        data: { item_type_id: itemTypeId, ...fieldsOf(form), primary_image_id: resolvePrimary(existing, plan, newRows, form.primaryKey) },
      });
      registrations.push({ id: ownId, images: verified });

      for (let i = 0; i < members.length; i++) {
        const m = members[i];
        const { prev, plan: mPlan } = memberPlans[i];
        const memberId = m.id ?? (await tx.reference_items.create({
          data: { item_type_id: m.itemTypeId, parent_reference_id: ownId, ...fieldsOf(m) },
          select: { reference_item_id: true },
        })).reference_item_id;
        await moveImages(tx, mPlan, m);
        const rows = await createReferenceImageRows(tx, memberId, memberVerified[i], mPlan.startSort);
        await tx.reference_items.update({
          where: { reference_item_id: memberId },
          data: { ...fieldsOf(m), primary_image_id: resolvePrimary(prev, mPlan, rows, m.primaryKey) },
        });
        registrations.push({ id: memberId, images: memberVerified[i] });
      }
      return ownId;
    }, { timeout: 30_000 });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      throw new ReferenceSaveError('יש כבר בייחוס המארז פריט ייחוס לסוג הזה. רענן את המסך ונסה שוב.', 409);
    }
    throw e;
  }

  // ---- after the commit: storage and registry ----------------------------------
  await removeReferenceImageObjects([
    ...plan.drop,
    ...memberPlans.flatMap((p) => p.plan.drop),
    ...removedMembers.flatMap((m) => m.images),
  ]);
  for (const r of registrations) await registerReferenceImages(r.id, r.images);
  return refId!;
}

/** Delete a reference item; a package reference takes its members with it. */
export async function deleteReferenceItem(id: number): Promise<void> {
  const existing = await prisma.reference_items.findUnique({
    where: { reference_item_id: id },
    include: { images: true, members: { include: { images: true } } },
  });
  if (!existing) throw new ReferenceSaveError('פריט הייחוס לא נמצא', 404);
  if (existing.parent_reference_id != null) {
    throw new ReferenceSaveError('פריט הייחוס הזה נמצא בתוך ייחוס מארז, ומוחקים אותו מתוך ייחוס המארז.');
  }
  // The rows first (the cascade takes the members and every image row), then
  // the bytes: a failed delete must not leave rows pointing at removed objects.
  await prisma.reference_items.delete({ where: { reference_item_id: id } });
  await removeReferenceImageObjects([...existing.images, ...existing.members.flatMap((m) => m.images)]);
}
