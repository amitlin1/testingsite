/**
 * Shifthouse ui/ — internal component library replacing MUI.
 * Flat, token-driven, RTL, single action blue. Import from "@/components/ui".
 */
import type { CSSProperties } from "react";

// Type aliases so `import type { SxProps } from "@/components/ui"` works.
// Generic to accept the MUI `SxProps<Theme>` form; the param is ignored.
export type SxProps<_T = unknown> = import("./sx").SxInput;
export type { SxInput } from "./sx";
export { sxToStyle, resolveColor, splitSystemProps } from "./sx";
export { cn } from "./utils";
export { useTheme, useMediaQuery, alpha, theme, tokens } from "./theme";
export type { Theme } from "./theme";

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
export { ConfirmDialog } from "./ConfirmDialog";
export type { ConfirmDialogProps } from "./ConfirmDialog";
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
export type { AutocompleteProps } from "./Autocomplete";
export {
  Grid, List, ListItem, ListItemButton, ListItemIcon, ListItemText, ListItemAvatar, ListSubheader,
  Collapse, Toolbar, Breadcrumbs,
} from "./Layout";
export {
  Fab, Avatar, Link, CardActionArea, Fade, Grow, Popover, Stepper, Step, StepLabel, StepConnector,
} from "./Misc";

export type { CSSProperties };
