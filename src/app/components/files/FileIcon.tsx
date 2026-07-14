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
import { SxProps } from '@mui/material';

interface FileIconProps {
  name: string;
  isFolder?: boolean;
  sx?: SxProps;
}

export function FileIcon({ name, isFolder, sx }: FileIconProps) {
  if (isFolder) return <FolderIcon sx={{ color: '#ffd54f', ...sx }} />;

  const ext = name.includes('.') ? name.split('.').pop()?.toLowerCase() : '';

  switch (ext) {
    case 'pdf':
      return <PictureAsPdfIcon sx={{ color: '#ef5350', ...sx }} />;
    case 'jpg':
    case 'jpeg':
    case 'png':
    case 'gif':
    case 'webp':
    case 'svg':
    case 'bmp':
      return <ImageIcon sx={{ color: '#66bb6a', ...sx }} />;
    case 'doc':
    case 'docx':
    case 'odt':
      return <DescriptionIcon sx={{ color: '#42a5f5', ...sx }} />;
    case 'xls':
    case 'xlsx':
    case 'ods':
    case 'csv':
      return <TableChartIcon sx={{ color: '#4caf50', ...sx }} />;
    case 'zip':
    case 'rar':
    case '7z':
    case 'tar':
    case 'gz':
      return <FolderZipIcon sx={{ color: '#ffa726', ...sx }} />;
    case 'mp4':
    case 'avi':
    case 'mov':
    case 'mkv':
    case 'wmv':
      return <VideoFileIcon sx={{ color: '#ab47bc', ...sx }} />;
    case 'mp3':
    case 'wav':
    case 'flac':
    case 'aac':
      return <AudioFileIcon sx={{ color: '#26c6da', ...sx }} />;
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
      return <CodeIcon sx={{ color: '#78909c', ...sx }} />;
    default:
      return <InsertDriveFileIcon sx={{ color: '#90a4ae', ...sx }} />;
  }
}

export default FileIcon;
