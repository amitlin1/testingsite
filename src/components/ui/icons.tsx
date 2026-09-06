"use client";
import React from "react";
import type { LucideIcon } from "lucide-react";
import {
  Clock as _Clock, Network as _Network, Plus as _Plus, Camera as _Camera, LineChart as _LineChart,
  ArrowLeft as _ArrowLeft, ArrowDown as _ArrowDown, ChevronDown as _ChevronDown, ArrowRight as _ArrowRight,
  ArrowUp as _ArrowUp, ClipboardList as _ClipboardList, ClipboardCheck as _ClipboardCheck, Paperclip as _Paperclip,
  IdCard as _IdCard, BarChart3 as _BarChart3, Building2 as _Building2, Calendar as _Calendar, Shapes as _Shapes,
  Check as _Check, CheckCircle2 as _CheckCircle2, X as _X, CloudUpload as _CloudUpload, FolderPlus as _FolderPlus,
  LayoutDashboard as _LayoutDashboard, Trash2 as _Trash2, FileText as _FileText, PieChart as _PieChart,
  Download as _Download, PenLine as _PenLine, Pencil as _Pencil, CircleAlert as _CircleAlert, ListFilter as _ListFilter,
  Folders as _Folders, Maximize as _Maximize, History as _History, House as _House, Inbox as _Inbox, Info as _Info,
  Package as _Package, ChevronUp as _ChevronUp, Link as _Link, Truck as _Truck, LogOut as _LogOut, Menu as _Menu,
  EllipsisVertical as _EllipsisVertical, ExternalLink as _ExternalLink, User as _User, MapPin as _MapPin, Play as _Play,
  Cog as _Cog, Printer as _Printer, QrCode as _QrCode, ScanLine as _ScanLine, ListPlus as _ListPlus, RefreshCw as _RefreshCw,
  Save as _Save, FlaskConical as _FlaskConical, Search as _Search, Send as _Send, Settings as _Settings, Gauge as _Gauge,
  Star as _Star, ArrowLeftRight as _ArrowLeftRight, Table as _Table, Activity as _Activity, Timer as _Timer,
  TrendingDown as _TrendingDown, TrendingUp as _TrendingUp, FileUp as _FileUp, List as _List, LayoutGrid as _LayoutGrid,
  TriangleAlert as _TriangleAlert, Image as _Image, FileArchive as _FileArchive, FileVideo as _FileVideo,
  Folder as _Folder, File as _File, FileAudio as _FileAudio, Code as _Code, SlidersHorizontal as _SlidersHorizontal,
  Lock as _Lock, Users as _Users, Database as _Database, CalendarDays as _CalendarDays, Route as _Route,
  Images as _Images, ChevronRight as _ChevronRight, ChevronLeft as _ChevronLeft,
} from "lucide-react";
import { sxToStyle, type SxInput } from "./sx";

/**
 * MUI-icon-name → lucide adapter. Import from "@/components/ui/icons"; the
 * export names match the old MUI icon names, so a former default icon import
 * becomes a named import here (e.g. Close as CloseIcon).
 * All icons: outline, strokeWidth 1.75, sizes 20/24/32 per the design.
 */
export interface IconProps extends Omit<React.SVGAttributes<SVGSVGElement>, "ref" | "color"> {
  fontSize?: "inherit" | "small" | "medium" | "large" | number;
  color?: string;
  htmlColor?: string;
  sx?: SxInput;
}

/** Compatible replacements for MUI's SvgIcon types. */
export type SvgIconComponent = React.ComponentType<IconProps>;
export type SvgIconProps = IconProps;

const MUI_COLOR: Record<string, string> = {
  inherit: "currentColor",
  primary: "var(--color-primary)",
  secondary: "var(--color-ink-muted-80)",
  action: "var(--color-ink-muted-80)",
  disabled: "var(--color-ink-muted-48)",
  error: "var(--color-destructive)",
  success: "var(--color-status-approved)",
  warning: "var(--color-status-late)",
  info: "var(--color-primary)",
};

function sizeFor(fs: IconProps["fontSize"]): number | string {
  if (typeof fs === "number") return fs;
  if (fs === "small") return 20;
  if (fs === "large") return 32;
  if (fs === "inherit") return "1em";
  return 24;
}

function wrap(Icon: LucideIcon) {
  return React.forwardRef<SVGSVGElement, IconProps>(function Icn(
    { fontSize = "medium", color, htmlColor, sx, style, ...rest },
    ref,
  ) {
    const col = htmlColor ?? (color ? MUI_COLOR[color] ?? color : undefined);
    return (
      <Icon
        ref={ref}
        size={sizeFor(fontSize) as number}
        strokeWidth={1.75}
        color={col}
        style={{ verticalAlign: "middle", flexShrink: 0, ...sxToStyle(sx), ...style }}
        {...(rest as React.SVGAttributes<SVGSVGElement>)}
      />
    );
  });
}

export const AccessTime = wrap(_Clock);
export const AccountTree = wrap(_Network);
export const Add = wrap(_Plus);
export const AddAPhoto = wrap(_Camera);
export const Analytics = wrap(_LineChart);
export const ArrowBack = wrap(_ArrowLeft);
export const ArrowDownward = wrap(_ArrowDown);
export const ArrowDropDown = wrap(_ChevronDown);
export const ArrowForward = wrap(_ArrowRight);
export const ArrowUpward = wrap(_ArrowUp);
export const Assessment = wrap(_ClipboardCheck);
export const Assignment = wrap(_ClipboardList);
export const AttachFile = wrap(_Paperclip);
export const Badge = wrap(_IdCard);
export const BarChart = wrap(_BarChart3);
export const Business = wrap(_Building2);
export const CalendarToday = wrap(_Calendar);
export const Category = wrap(_Shapes);
export const Check = wrap(_Check);
export const CheckCircle = wrap(_CheckCircle2);
export const CheckCircleOutline = wrap(_CheckCircle2);
export const Clear = wrap(_X);
export const Close = wrap(_X);
export const CloudUpload = wrap(_CloudUpload);
export const CloudUploadOutlined = wrap(_CloudUpload);
export const CreateNewFolder = wrap(_FolderPlus);
export const Dashboard = wrap(_LayoutDashboard);
export const Delete = wrap(_Trash2);
export const DeleteOutline = wrap(_Trash2);
export const Description = wrap(_FileText);
export const DonutLarge = wrap(_PieChart);
export const Download = wrap(_Download);
export const DriveFileRenameOutline = wrap(_PenLine);
export const Edit = wrap(_Pencil);
export const EditNote = wrap(_PenLine);
export const EditOutlined = wrap(_Pencil);
export const Error = wrap(_CircleAlert);
export const ErrorOutline = wrap(_CircleAlert);
export const ExpandMore = wrap(_ChevronDown);
export const FilterList = wrap(_ListFilter);
export const FolderCopy = wrap(_Folders);
export const Fullscreen = wrap(_Maximize);
export const History = wrap(_History);
export const Home = wrap(_House);
export const Inbox = wrap(_Inbox);
export const Info = wrap(_Info);
export const Inventory = wrap(_Package);
export const Inventory2Outlined = wrap(_Package);
export const KeyboardArrowDown = wrap(_ChevronDown);
export const KeyboardArrowUp = wrap(_ChevronUp);
export const Link = wrap(_Link);
export const LocalShipping = wrap(_Truck);
export const Logout = wrap(_LogOut);
export const Menu = wrap(_Menu);
export const MoreVert = wrap(_EllipsisVertical);
export const OpenInNew = wrap(_ExternalLink);
export const Person = wrap(_User);
export const PictureAsPdf = wrap(_FileText);
export const PieChart = wrap(_PieChart);
export const Place = wrap(_MapPin);
export const PlayArrowRounded = wrap(_Play);
export const PrecisionManufacturing = wrap(_Cog);
export const Print = wrap(_Printer);
export const QrCode = wrap(_QrCode);
export const QrCode2 = wrap(_QrCode);
export const QrCodeScanner = wrap(_ScanLine);
export const Queue = wrap(_ListPlus);
export const Refresh = wrap(_RefreshCw);
export const Save = wrap(_Save);
export const Science = wrap(_FlaskConical);
export const Search = wrap(_Search);
export const Send = wrap(_Send);
export const Settings = wrap(_Settings);
export const ShowChart = wrap(_LineChart);
export const Speed = wrap(_Gauge);
export const Star = wrap(_Star);
export const StarBorder = wrap(_Star);
export const SwapHoriz = wrap(_ArrowLeftRight);
export const TableChart = wrap(_Table);
export const Timeline = wrap(_Activity);
export const Timer = wrap(_Timer);
export const TrendingDown = wrap(_TrendingDown);
export const TrendingUp = wrap(_TrendingUp);
export const UploadFile = wrap(_FileUp);
export const ViewList = wrap(_List);
export const ViewModule = wrap(_LayoutGrid);
export const Warning = wrap(_TriangleAlert);
export const Image = wrap(_Image);
export const FolderZip = wrap(_FileArchive);
export const VideoFile = wrap(_FileVideo);
export const Folder = wrap(_Folder);
export const InsertDriveFile = wrap(_File);
export const AudioFile = wrap(_FileAudio);
export const Code = wrap(_Code);
export const Tune = wrap(_SlidersHorizontal);
export const Lock = wrap(_Lock);
export const People = wrap(_Users);
export const Source = wrap(_Database);
export const AssignmentTurnedIn = wrap(_ClipboardCheck);
export const EventNote = wrap(_CalendarDays);
export const AltRoute = wrap(_Route);
export const PhotoLibrary = wrap(_Images);
// Rail collapse / expand affordances. Named for the glyph, not for a side: in an
// RTL layout the *collapse* direction is the one the caller picks.
export const ChevronRight = wrap(_ChevronRight);
export const ChevronLeft = wrap(_ChevronLeft);
