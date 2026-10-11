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

export function FileIcon({ name, isFolder, sx }: FileIconProps) {
  if (isFolder) return <FolderIcon aria-hidden sx={{ color: KIND_COLOR.folder, ...sx }} />;

  const ext = name.includes('.') ? name.split('.').pop()?.toLowerCase() : '';

  switch (ext) {
    case 'pdf':
      return <PictureAsPdfIcon aria-hidden sx={{ color: KIND_COLOR.pdf, ...sx }} />;
    case 'jpg':
    case 'jpeg':
    case 'png':
    case 'gif':
    case 'webp':
    case 'svg':
    case 'bmp':
      return <ImageIcon aria-hidden sx={{ color: KIND_COLOR.image, ...sx }} />;
    case 'doc':
    case 'docx':
    case 'odt':
      return <DescriptionIcon aria-hidden sx={{ color: KIND_COLOR.doc, ...sx }} />;
    case 'xls':
    case 'xlsx':
    case 'ods':
    case 'csv':
      return <TableChartIcon aria-hidden sx={{ color: KIND_COLOR.sheet, ...sx }} />;
    case 'zip':
    case 'rar':
    case '7z':
    case 'tar':
    case 'gz':
      return <FolderZipIcon aria-hidden sx={{ color: KIND_COLOR.archive, ...sx }} />;
    case 'mp4':
    case 'avi':
    case 'mov':
    case 'mkv':
    case 'wmv':
      return <VideoFileIcon aria-hidden sx={{ color: KIND_COLOR.video, ...sx }} />;
    case 'mp3':
    case 'wav':
    case 'flac':
    case 'aac':
      return <AudioFileIcon aria-hidden sx={{ color: KIND_COLOR.audio, ...sx }} />;
    case 'js':
    case 'ts':
    case 'py':
    case 'java':
    case 'c':
    case 'cpp':
    case 'cs':
    case 'html':
    case 'css':
    case 'json':
    case 'xml':
      return <CodeIcon aria-hidden sx={{ color: KIND_COLOR.code, ...sx }} />;
    default:
      return <InsertDriveFileIcon aria-hidden sx={{ color: KIND_COLOR.other, ...sx }} />;
  }
}

export default FileIcon;
