/**
 * Shifthouse ui/ — internal component library replacing MUI.
 * Flat, token-driven, RTL, single action blue. Import from "@/components/ui".
 */

// Type alias so `import type { SxProps } from "@/components/ui"` works.
export type SxProps = import("./sx").SxInput;
export { cn } from "./utils";
export { useMediaQuery } from "./useMediaQuery";

export { Box, Stack, Divider } from "./primitives";
export { Typography } from "./Typography";
export { Button } from "./Button";
export { IconButton } from "./IconButton";
export { TextField, SearchInput, InputAdornment } from "./TextField";
export { Select, MenuItem } from "./Select";
export { Switch, Checkbox, FormControlLabel } from "./Toggles";
export { ToggleButton, ToggleButtonGroup } from "./Segmented";
export { Chip, StatusPill, Tag } from "./Chips";
export type { TagProps, TagTone } from "./Chips";
export { Paper } from "./Surfaces";
export { Dialog, DialogParked, DialogReturnFocus, DialogTitle, DialogContent, DialogContentText, DialogActions } from "./Dialog";
export { ConfirmDialog } from "./ConfirmDialog";
export type { ConfirmDialogProps } from "./ConfirmDialog";
export { Alert, Snackbar } from "./Feedback";
export { useToast } from "./Toast";
export { LinearProgress, CircularProgress } from "./Progress";
export { Skeleton } from "./Skeleton";
export { Table, TableContainer, TableHead, TableBody, TableRow, TableCell } from "./Table";
export { Tooltip } from "./Tooltip";
export { AnchoredPopover, type AnchoredPopoverProps } from "./AnchoredPopover";
export { Menu } from "./Menu";
export { Autocomplete } from "./Autocomplete";
export type { AutocompleteProps, OptionLiProps } from "./Autocomplete";
export { default as SearchableCombobox } from "./SearchableCombobox";
export { default as FieldLabel } from "./FieldLabel";
export { ListItemIcon, Collapse, Breadcrumbs } from "./Layout";
export { Avatar, Stepper, Step, StepLabel } from "./Misc";

