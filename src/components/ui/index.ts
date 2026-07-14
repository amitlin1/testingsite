/**
 * Shifthouse ui/ — internal component library replacing MUI.
 * Flat, token-driven, RTL, single action blue. Import from "@/components/ui".
 */
import type { CSSProperties } from "react";

// Type aliases so `import type { SxProps, Theme } from "@/components/ui"` works.
export type SxProps = Record<string, unknown>;
export type Theme = Record<string, unknown>;
export type { SxInput } from "./sx";
export { sxToStyle, resolveColor, splitSystemProps } from "./sx";
export { cn } from "./utils";

export { Box, Stack, Divider, Container } from "./primitives";
export { Typography } from "./Typography";
export { Button } from "./Button";
export { IconButton } from "./IconButton";
export { TextField, SearchInput, InputAdornment } from "./TextField";
export { Select, MenuItem, FormControl, InputLabel } from "./Select";
export { Switch, Checkbox, Radio, RadioGroup, FormControlLabel } from "./Toggles";
export { ToggleButton, ToggleButtonGroup } from "./Segmented";
export { Chip, Badge, StatusPill } from "./Chips";
export { Paper, Card, CardContent, CardActions, CardHeader } from "./Surfaces";
export { Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions, DialogClose } from "./Dialog";
export { Tabs, Tab } from "./Tabs";
export { Alert, AlertTitle, Snackbar } from "./Feedback";
export { LinearProgress, CircularProgress } from "./Progress";
export { Skeleton } from "./Skeleton";
export {
  Table, TableContainer, TableHead, TableBody, TableFooter, TableRow, TableCell, TableSortLabel,
} from "./Table";
export { Tooltip } from "./Tooltip";
export { Menu } from "./Menu";
export { Autocomplete } from "./Autocomplete";
export {
  Grid, List, ListItem, ListItemButton, ListItemIcon, ListItemText, ListItemAvatar, ListSubheader,
  Collapse, Toolbar, Breadcrumbs,
} from "./Layout";
export {
  Fab, Avatar, Link, CardActionArea, Fade, Grow, Popover, Stepper, Step, StepLabel, StepConnector,
} from "./Misc";

/** Passthrough helpers for a couple of MUI utilities used in a few spots. */
export const useTheme = (): { direction: string; palette: Record<string, unknown> } => ({
  direction: "rtl",
  palette: {},
});
export const alpha = (color: string, value: number): string => {
  const c = color.trim();
  if (c.startsWith("#")) {
    const hex = c.slice(1);
    const full = hex.length === 3 ? hex.split("").map((x) => x + x).join("") : hex;
    const r = parseInt(full.slice(0, 2), 16), g = parseInt(full.slice(2, 4), 16), b = parseInt(full.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${value})`;
  }
  return c;
};
export const styled = undefined as unknown; // guard: styled() not supported — migrate call sites
export type { CSSProperties };
