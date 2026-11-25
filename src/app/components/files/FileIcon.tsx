import { PictureAsPdf as PictureAsPdfIcon } from "@/components/ui/icons";
import { Image as ImageIcon } from "@/components/ui/icons";
import { Description as DescriptionIcon } from "@/components/ui/icons";
import { TableChart as TableChartIcon } from "@/components/ui/icons";
import { FolderZip as FolderZipIcon } from "@/components/ui/icons";
import { VideoFile as VideoFileIcon } from "@/components/ui/icons";
import { Folder as FolderIcon } from "@/components/ui/icons";
import { InsertDriveFile as InsertDriveFileIcon } from "@/components/ui/icons";
import { AudioFile as AudioFileIcon } from "@/components/ui/icons";
import { Code as CodeIcon } from "@/components/ui/icons";
import { SxProps } from "@/components/ui";
import { fileKind, type FileKind } from "@/lib/file-types";

interface FileIconProps {
  name: string;
  isFolder?: boolean;
  sx?: SxProps;
}

/* The hue still codes the file kind, but every stroke now reaches 3:1 on
   white (the old MUI 400 shades were 1.4–2.9:1 on a 1.75px outline). Tokens
   only; the two kinds with no token of their own are mixed from two. */
const KIND_COLOR = {
  folder: "var(--color-status-late)",                                              // amber, 3.2:1
  pdf: "var(--color-destructive)",                                                 // red, 5.6:1
  image: "var(--color-status-approved)",                                           // green, 4.3:1
  doc: "var(--color-primary)",                                                     // blue, 5.6:1
  sheet: "var(--color-success-ink)",                                               // deep green, 5.5:1
  archive: "var(--color-warning-ink)",                                             // brown-amber, 5.4:1
  video: "color-mix(in srgb, var(--color-primary) 55%, var(--color-destructive))", // violet, ~7:1
  audio: "color-mix(in srgb, var(--color-primary) 50%, var(--color-success-ink))", // teal, ~5.7:1
  code: "var(--color-ink-muted-48)",                                               // grey, 5.1:1
  other: "var(--color-ink-muted-48)",
} as const;

const ICON_OF_KIND: Record<FileKind, typeof InsertDriveFileIcon> = {
  pdf: PictureAsPdfIcon,
  image: ImageIcon,
  doc: DescriptionIcon,
  sheet: TableChartIcon,
  archive: FolderZipIcon,
  video: VideoFileIcon,
  audio: AudioFileIcon,
  code: CodeIcon,
  other: InsertDriveFileIcon,
};

export function FileIcon({ name, isFolder, sx }: FileIconProps) {
  if (isFolder) return <FolderIcon aria-hidden sx={{ color: KIND_COLOR.folder, ...sx }} />;
  const kind = fileKind(name);
  const Icon = ICON_OF_KIND[kind];
  return <Icon aria-hidden sx={{ color: KIND_COLOR[kind], ...sx }} />;
}

export default FileIcon;
