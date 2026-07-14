# משימה: התאמת מסך "דוחות וניהול פריטים" ל-Shifthouse

התאם את מסך ניהול הפריטים (`ItemTable.tsx` + `insertPopup.tsx`) למראה שאושר ב-reference (`Items (reference).html`). המראה הזה שטוח, RTL, כחול פעולה יחיד `#0066cc`, ללא elevation/צללים של MUI, ללא ירוק/כתום.

## קבצים בחבילה
- `Items (reference).html` — **מקור האמת החזותי**. פתח בדפדפן; ככה הכל צריך להיראות.
- `styles/shifthouse.css` — טוקנים + מחלקות ל-hover/focus/scrollbar (מה ש-inline styles לא יכול). **ייבא פעם אחת** ב-`app/layout.tsx`: `import "@/styles/shifthouse.css";`
- `components/ItemsToolbar.tsx` — הכותרת + חיפוש + פילטרים + כפתור **הוסף פריט** (הטמפלייט שביקשת).
- `components/DataTable.tsx` — טבלה גנרית עם ה-`<th>` הנכון + **hover על שורות** + `StatusPill` + `ProgressCell`.
- `components/AddItemDialog.tsx` — הפופאפ **הוספת פריט** מעוצב מחדש (החלק העליון, שדות, טבלת פריטי המשלוח, פריטים מחוברים, פוטר).

## מה לשנות — לפי הבקשות

### 1. פופאפ "הוסף פריט" (החלק העליון שונה)
החלף את ה-chrome של `insertPopup.tsx` ב-`AddItemDialog.tsx`:
- כותרת שטוחה `הוספת פריט חדש לבדיקה` + כפתור **סרוק** (pill משני) + צ'יפ אצווה כחול (`פריט X מתוך Y`) + כפתור סגירה עגול — במקום `DialogTitle` של MUI.
- כרטיס המודל שטוח עם הצל היחיד של המערכת (`rgba(0,0,0,0.22) 3px 5px 30px`), radius 18, פוטר על `#fafafc` עם border-top.
- **הסר** את הגרדיאנט בכותרת "פריטים במשלוח" ואת צבעי ההתקדמות ירוק/כתום — פס התקדמות כחול יחיד; השלמה = מילוי מלא + track כחלחל.
- שמור על זרימת הנתונים הקיימת: `AddItemDialog` הוא presentational — קבל `shipmentOptions/customerOptions/itemTypeOptions/routeOptions/shipmentItems`, וב-`onSubmit(form, subItems)` בנה את ה-`NewItem` ושלח ל-`/api/items` בדיוק כמו היום (כולל לוגיקת האצווה `batchIndex/batchTotal`). את הקומבובוקסים אפשר להשאיר `<SearchableCombobox>` הקיים אם רוצים חיפוש אסינכרוני — ה-wrappers כבר בסגנון Shifthouse; ה-`<Select>` שבקובץ הוא ברירת מחדל עצמאית.

### 2. Hover על הטבלאות (כרגע אין)
כל שורת טבלה מקבלת `className="sh-row sh-row--clickable"` → hover ל-`#fafafc`. גם טבלת "פריטים במשלוח" בפופאפ. ה-hover מוגדר ב-`shifthouse.css` (אמיתי, לא inline).

### 3. סרגל חיפוש + כפתור "הוסף פריט"
החלף את ה-`Toolbar/Paper` העליון ב-`<ItemsToolbar ... />`. כפתור ההוספה = pill כחול (`#0066cc`, radius 9999, `הוסף פריט` + אייקון Plus), לא rounded-rect עם צל. שדה חיפוש עם אייקון, dropdowns שטוחים. "נקה הכל" הופך לקישור כחול (מופיע רק כשיש סינון פעיל).

### 4. עיצוב ה-`<th>` של הטבלאות
כל הטבלאות עוברות ל-`DataTable` (או למחלקות `.sh-table/.sh-th/.sh-row/.sh-td`). כותרת: רקע parchment `#f5f5f7`, טקסט 11.5px משקל 600 צבע `#7a7a7a`, border-bottom hairline. שורות: מספרים `tabular-nums`, סטטוס דרך `<StatusPill active={...}/>`, התקדמות דרך `<ProgressCell/>`.

## החלף את `ItemTable.tsx` בערך כך
```tsx
import ItemsToolbar from "@/components/ItemsToolbar";
import DataTable, { StatusPill, ProgressCell } from "@/components/DataTable";
import AddItemDialog from "@/components/AddItemDialog";

// ...toolbar
<ItemsToolbar search={search} onSearch={setSearch} onAdd={() => setInsertOpen(true)}
  filters={[
    { key:"status", placeholder:"סטטוס", value:statusFilter, options:statusOpts, onChange:setStatusFilter },
    { key:"type",   placeholder:"סוג פריט", value:typeFilter,  options:typeOpts,   onChange:setTypeFilter },
    { key:"ship",   placeholder:"משלוח", value:shipFilter,  options:shipOpts,   onChange:setShipFilter },
  ]}/>

// ...table
<DataTable rows={filteredRows} getRowKey={(r)=>r.item_id} onRowClick={setSelected}
  columns={[
    { key:"barcode", header:"ברקוד", align:"center", width:50, cell:(r)=> <BarcodeButton row={r}/> },
    { key:"type",    header:"סוג",   nowrap:true, muted:true, cell:(r)=> r.item_type_desc ?? "—" },
    { key:"serial",  header:"סריאלי", nums:true, bold:true, nowrap:true, cell:(r)=> r.serial_no ?? "—" },
    // ...מקט / דגם / יצרן / מס' יצרן / משלוח / לקוח
    { key:"status",  header:"סטטוס", cell:(r)=> <StatusPill label={r.item_status_desc} active={r.current_status===2}/> },
    { key:"progress",header:"התקדמות", width:180, cell:(r)=> <ProgressCell pct={pctOf(r)} text={textOf(r)}/> },
    { key:"date",    header:"תאריך קליטה", width:132, muted:true, nums:true, nowrap:true, cell:(r)=> fmt(r.created_at) },
  ]}/>
```

## כללי ברזל (Shifthouse)
כחול אחד `#0066cc` בלבד · ללא צל על card/button (רק תחת תצלום) · ללא gradient · ללא משקל 500 · נקודת סטטוס: כחול=פעיל, `#7a7a7a`=אחר, אף פעם לא ירוק/כתום · אייקונים Lucide בלבד · RTL עם logical properties.

## אימות
- `import "@/styles/shifthouse.css"` קיים פעם אחת.
- hover נראה על כל שורות הטבלה.
- אין ירוק/כתום בשום מקום במסך (פס התקדמות + נקודות סטטוס = כחול/אפור).
- הפופאפ שטוח, בלי צללי MUI, זהה ל-reference.
- `npm run build` עובר.
