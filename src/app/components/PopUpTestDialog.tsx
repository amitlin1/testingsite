"use client";
import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Box,
  Typography,
  Stack,
  Alert,
  IconButton,
  useTheme,
  alpha,
  CircularProgress,
  Chip
} from "@/components/ui";
import { Close as CloseIcon } from "@/components/ui/icons";
import { Assignment as AssignmentIcon } from "@/components/ui/icons";
import { Speed as SpeedIcon } from "@/components/ui/icons";
import { Save as SaveIcon } from "@/components/ui/icons";
import { Science as ScienceIcon } from "@/components/ui/icons";
import { ArrowBack as ArrowBackIcon } from "@/components/ui/icons";
import { CheckCircle as CheckCircleIcon } from "@/components/ui/icons";
import { Person as PersonIcon } from "@/components/ui/icons";
import ItemFilesPanel from "./ItemFilesPanel";
import type { StationTestDialogProps } from "@/types";

export default function PopUpTestDialog({
  open,
  onClose,
  onSubmit,
  item,
  station,
  workerId,
  workerName,
}: StationTestDialogProps) {
  // The dialog renders primitives derived from the ItemRow / TestStation it receives.
  const itemId = item.item_id;
  const stationId = station.test_station_id;
  const itemName = item.model ?? undefined;
  const currentStatus = item.current_status ?? undefined;
  const [result, setResult] = React.useState<number>(0);
  const [comments, setComments] = React.useState<string>("");
  console.log( open,
  onClose,
  onSubmit,
  itemId,
  stationId,
  itemName,
  currentStatus,
  workerId,
  workerName,)
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const theme = useTheme();

  const handleSubmit = async (action: 'save' | 'sendToResearch' | 'returnToRoute' | 'finishRoute' = 'save') => {
    setError(null);

    // Worker now comes from the page-level picker on the testing page.
    if (workerId == null) {
      setError("יש לבחור עובד בכותרת מסך הבדיקות לפני סיום בדיקה");
      return;
    }

    setLoading(true);
    try {
      await onSubmit({
        Result: result,
        Comments: comments || undefined,
        WorkerID: workerId,
        sendToResearch: action === 'sendToResearch',
        returnToRoute: action === 'returnToRoute',
        finishRoute: action === 'finishRoute',
        // Sending undefined for SentAt/ReturnAt as they are hidden
        SentAt: undefined,
        ReturnAt: undefined,
      });
      // Reset form
      setResult(0);
      setComments("");
      onClose();
    } catch (error: any) {
      console.error("Error submitting test result:", error);
      setError(error?.message || "שגיאה בשמירת תוצאת בדיקה");
    } finally {
      setLoading(false);
    }
  };

  const isResearchStatus = currentStatus === 5;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="sm"
      PaperProps={{
        sx: {
          borderRadius: 4,
          overflow: "visible",
          background: "rgba(255, 255, 255, 0.9)",
          backdropFilter: "blur(24px)",
          boxShadow: "0 24px 48px rgba(0,0,0,0.2)",
          border: "1px solid rgba(255, 255, 255, 0.6)",
        }
      }}
    >
        {/* Header Section */}
        <Box sx={{
            position: "relative",
            p: 4,
            pb: 2,
            borderBottom: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
            textAlign: "center"
        }}>
            <IconButton
                onClick={onClose}
                sx={{
                    position: "absolute",
                    left: 24,
                    top: 24,
                    color: "text.secondary",
                    bgcolor: "rgba(0,0,0,0.03)",
                    "&:hover": { bgcolor: alpha(theme.palette.error.main, 0.1), color: theme.palette.error.main }
                }}
            >
                <CloseIcon />
            </IconButton>

            <Typography variant="h4" sx={{ fontWeight: 800, background: "linear-gradient(45deg, #1565C0, #42A5F5)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", mb: 1.5, textShadow: "0 10px 20px rgba(0,0,0,0.1)" }}>
                סיום בדיקה
            </Typography>
            
            <Stack direction="row" spacing={2} justifyContent="center" alignItems="center">
                <Chip 
                    label={`עמדה #${stationId}`} 
                    sx={{ fontWeight: 600, bgcolor: alpha(theme.palette.primary.main, 0.1), color: "primary.main" }} 
                />
                 <Typography variant="body2" color="text.secondary">
                    •
                </Typography>
                <Chip 
                    label={itemName || `פריט #${itemId}`} 
                    sx={{ fontWeight: 600, bgcolor: alpha(theme.palette.secondary.main, 0.1), color: "secondary.main" }} 
                />
            </Stack>
        </Box>

      <DialogContent sx={{ p: 4 }}>
        <Stack spacing={4}>
          {error && (
            <Alert 
                severity="error" 
                onClose={() => setError(null)}
                sx={{ borderRadius: 3, border: `1px solid ${alpha(theme.palette.error.main, 0.2)}` }}
            >
              {error}
            </Alert>
          )}

          {/* Result Input */}
          <Box>
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 1.5, gap: 1.5 }}>
                <SpeedIcon color="primary" />
                <Typography variant="subtitle1" fontWeight={700} color="text.primary">
                    תוצאת בדיקה
                </Typography>
            </Box>
            <TextField
                hiddenLabel
                type="number"
                value={result}
                onChange={(e) => setResult(Number(e.target.value))}
                fullWidth
                placeholder="0"
                inputProps={{ 
                    min: 0, 
                    style: { fontSize: '1.5rem', fontWeight: 700, padding: '16px', textAlign: 'center' } 
                }}
                sx={{
                    "& .MuiOutlinedInput-root": {
                        borderRadius: 3,
                        bgcolor: "#f8f9fa",
                        transition: "all 0.2s",
                        "&:hover": { bgcolor: "white", boxShadow: "0 4px 12px rgba(0,0,0,0.05)" },
                        "&.Mui-focused": { bgcolor: "white", boxShadow: `0 0 0 4px ${alpha(theme.palette.primary.main, 0.2)}` }
                    },
                    "& .MuiOutlinedInput-notchedOutline": { border: "1px solid rgba(0,0,0,0.08)" }
                }}
            />
          </Box>

          {/* Active worker — surfaced from the page-level picker, read-only here. */}
          <Box>
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 1.5, gap: 1.5 }}>
                <PersonIcon color="primary" />
                <Typography variant="subtitle1" fontWeight={700} color="text.primary">
                    עובד מבצע <Typography component="span" color="error" fontWeight={700}>*</Typography>
                </Typography>
            </Box>
            {workerId != null ? (
                <Chip
                    icon={<PersonIcon />}
                    label={workerName ? `${workerName} (#${workerId})` : `עובד #${workerId}`}
                    sx={{
                        fontWeight: 600,
                        bgcolor: alpha(theme.palette.primary.main, 0.08),
                        color: 'primary.main',
                        height: 40,
                        '& .MuiChip-icon': { color: 'primary.main' },
                    }}
                />
            ) : (
                <Alert severity="warning" sx={{ borderRadius: 2 }}>
                    בחר עובד בכותרת מסך הבדיקות לפני סיום בדיקה
                </Alert>
            )}
          </Box>

          {/* Files attached to this item — uploads/edits use the active worker */}
          <Box>
            <ItemFilesPanel itemId={itemId} workerId={workerId ?? null} stationTypeId={station.test_station_type_id} compact maxHeight={300} />
          </Box>

          {/* Comments */}
          <Box>
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 1.5, gap: 1.5 }}>
                <AssignmentIcon color="primary" />
                <Typography variant="subtitle1" fontWeight={700} color="text.primary">
                    הערות נוספות
                </Typography>
            </Box>
            <TextField
                hiddenLabel
                value={comments}
                onChange={(e) => setComments(e.target.value)}
                multiline
                rows={3}
                fullWidth
                placeholder="הוסף הערות כאן..."
                sx={{
                    "& .MuiOutlinedInput-root": {
                        borderRadius: 3,
                        bgcolor: "#f8f9fa",
                        padding: '16px',
                        transition: "all 0.2s",
                        "&:hover": { bgcolor: "white", boxShadow: "0 4px 12px rgba(0,0,0,0.05)" },
                        "&.Mui-focused": { bgcolor: "white", boxShadow: `0 0 0 4px ${alpha(theme.palette.primary.main, 0.2)}` }
                    },
                    "& .MuiOutlinedInput-notchedOutline": { border: "1px solid rgba(0,0,0,0.08)" }
                }}
            />
          </Box>

        </Stack>
      </DialogContent>
      
      <DialogActions sx={{ p: 4, pt: 0, justifyContent: 'space-between' }}>
        <Button 
            onClick={onClose} 
            disabled={loading}
            sx={{ 
                borderRadius: 3, 
                px: 3, 
                py: 1.5, 
                color: 'text.secondary',
                fontWeight: 600,
                bgcolor: "rgba(0,0,0,0.03)",
                "&:hover": { bgcolor: alpha(theme.palette.text.primary, 0.1) }
            }}
        >
          ביטול
        </Button>
        {isResearchStatus ? (
          <Stack direction="row" sx={{ gap: '32px' }}>
            <Button
              onClick={loading ? undefined : () => handleSubmit('returnToRoute')}
              variant="outlined"
              disabled={!workerId || loading}
              startIcon={loading ? <CircularProgress size={20} color="inherit" /> : <ArrowBackIcon />}
              sx={{
                borderRadius: 3,
                px: 3,
                py: 1.5,
                fontWeight: 600,
                borderColor: theme.palette.info.main,
                color: theme.palette.info.main,
                borderWidth: 2,
                gap: 2.5,
                "&:hover": { borderWidth: 2, bgcolor: alpha(theme.palette.info.main, 0.1) }
              }}
            >
              החזר למסלול
            </Button>
            <Button
              onClick={loading ? undefined : () => handleSubmit('finishRoute')}
              variant="contained"
              disabled={!workerId}
              startIcon={loading ? <CircularProgress size={20} color="inherit" /> : <CheckCircleIcon />}
              sx={{
                borderRadius: 3,
                px: 4,
                py: 1.5,
                fontWeight: 700,
                gap: 2.5,
                boxShadow: "0 8px 16px rgba(46, 125, 50, 0.2)",
                background: "linear-gradient(45deg, #43a047, #66bb6a)",
                "&:hover": { transform: "translateY(-1px)", boxShadow: "0 12px 20px rgba(46, 125, 50, 0.3)" }
              }}
            >
              {loading ? "שומר..." : "סיים מסלול"}
            </Button>
          </Stack>
        ) : (
          <Stack direction="row" sx={{ gap: '32px' }}>
            <Button
              onClick={loading ? undefined : () => handleSubmit('sendToResearch')}
              variant="outlined"
              disabled={!workerId || loading}
              startIcon={loading ? <CircularProgress size={20} color="inherit" /> : <ScienceIcon />}
              sx={{
                borderRadius: 3,
                px: 3,
                py: 1.5,
                fontWeight: 600,
                borderColor: theme.palette.secondary.main,
                color: theme.palette.secondary.main,
                borderWidth: 2,
                gap: 2.5,
                "&:hover": { borderWidth: 2, bgcolor: alpha(theme.palette.secondary.main, 0.1) }
              }}
            >
              העבר לחקר
            </Button>
            <Button
              onClick={loading ? undefined : () => handleSubmit('save')}
              variant="contained"
              disabled={!workerId}
              startIcon={loading ? <CircularProgress size={20} color="inherit" /> : <SaveIcon />}
              sx={{
                borderRadius: 3,
                px: 4,
                py: 1.5,
                fontWeight: 700,
                gap: 2.5,
                boxShadow: "0 8px 16px rgba(25, 118, 210, 0.2)",
                background: "linear-gradient(45deg, #1976d2, #42a5f5)",
                "&:hover": { transform: "translateY(-1px)", boxShadow: "0 12px 20px rgba(25, 118, 210, 0.3)" }
              }}
            >
              {loading ? "שומר..." : "שמור וסיים"}
            </Button>
          </Stack>
        )}
      </DialogActions>
    </Dialog>
  );
}