import { createTheme } from '@mui/material/styles';

/**
 * Shifthouse redesign theme.
 *
 * Design language: Apple-style, single blue accent (#0066cc), flat cards,
 * 8px field/button radius, 12-18px card radius, RTL/Hebrew.
 *
 * NOTE on fonts: the design spec asks for Heebo/Inter. This app is air-gapped
 * (offline build, no CDN at runtime), so we keep the locally-bundled Rubik
 * variable font (loaded in layout.tsx) which is a close geometric Hebrew sans.
 * Swapping to Heebo would mean bundling its .ttf locally the same way.
 *
 * Design tokens are also exposed on `theme.tokens` for screens that need raw
 * hexes/shadows the palette doesn't cover (surfaces, hairlines, panel shadow).
 */

// ---- Raw design tokens -----------------------------------------------------
const tokens = {
  accent: '#0066cc',
  accentHover: '#0058b3',
  focusRing: '#0071e3',
  ink: '#1d1d1f',
  muted: '#7a7a7a',
  mutedSoft: '#9a9aa0',
  fieldLabel: '#555555',
  surface: {
    page: '#f5f5f7',
    card: '#ffffff',
    subtle: '#fafafc',
    rowHover: '#fafafc',
    selected: '#f3f8ff',
  },
  hairline: '#e0e0e0',
  status: {
    active: '#0066cc',
    pending: '#d97706',
    done: '#1f8a5b',
    destructive: '#bf3535',
  },
  radius: {
    field: 8,
    card: 14,
    pill: 9999,
  },
  shadow: {
    modal: 'rgba(0,0,0,0.22) 3px 5px 30px',
    panel: 'rgba(0,0,0,0.16) 0 12px 38px',
    card: 'rgba(0,0,0,0.05) 0 1px 2px',
  },
} as const;

// Expose tokens on the MUI theme object (typed).
declare module '@mui/material/styles' {
  interface Theme {
    tokens: typeof tokens;
  }
  interface ThemeOptions {
    tokens?: typeof tokens;
  }
}

export const theme = createTheme({
  direction: 'rtl',
  tokens,
  shape: {
    borderRadius: tokens.radius.field,
  },
  palette: {
    mode: 'light',
    primary: {
      main: tokens.accent,
      dark: tokens.accentHover,
    },
    secondary: {
      main: '#455A64',
    },
    success: {
      main: tokens.status.done,
    },
    warning: {
      main: tokens.status.pending,
    },
    error: {
      main: tokens.status.destructive,
    },
    info: {
      main: tokens.accent,
    },
    background: {
      default: tokens.surface.page,
      paper: tokens.surface.card,
    },
    text: {
      primary: tokens.ink,
      secondary: tokens.muted,
    },
    divider: tokens.hairline,
  },

  typography: {
    fontFamily: `var(--font-rubik), "Heebo", "Inter", "Segoe UI", "Arial", sans-serif`,
    fontWeightLight: 300,
    fontWeightRegular: 400,
    fontWeightMedium: 600,
    fontWeightBold: 700,
    fontSize: 14,
    h1: { fontWeight: 700, fontSize: '32px', letterSpacing: '-0.5px' },
    h2: { fontWeight: 700, letterSpacing: '-0.4px' },
    h3: { fontWeight: 700, letterSpacing: '-0.3px' },
    h4: { fontWeight: 700, letterSpacing: '-0.2px' },
    button: { textTransform: 'none', fontWeight: 600 },
  },

  components: {
    MuiCssBaseline: {
      styleOverrides: {
        // Tabular numerals for codes/dates/quantities throughout.
        'input, .MuiTypography-root': {
          fontVariantNumeric: 'tabular-nums',
        },
      },
    },

    MuiInputLabel: {
      styleOverrides: {
        root: {
          transformOrigin: 'right !important',
          left: 'inherit !important',
          right: '1.75rem !important',
          color: tokens.fieldLabel,
          fontWeight: 400,
          overflow: 'unset',
        },
      },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          borderRadius: tokens.radius.field,
          backgroundColor: '#fff',
          '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
            borderColor: tokens.focusRing,
            borderWidth: 1,
            boxShadow: `0 0 0 3px rgba(0,113,227,0.18)`,
          },
        },
        notchedOutline: {
          textAlign: 'right',
          borderColor: tokens.hairline,
        },
      },
    },

    MuiTextField: {
      styleOverrides: {
        root: {
          '& input[type=number]::-webkit-outer-spin-button': { display: 'none' },
          '& input[type=number]::-webkit-inner-spin-button': { display: 'none' },
          '& input[type=number]': {
            MozAppearance: 'textfield',
          },
        },
      },
    },
    MuiFormHelperText: {
      styleOverrides: {
        root: {
          textAlign: 'right',
          direction: 'rtl',
        },
      },
    },

    // Buttons: pill CTAs, subtle press animation.
    MuiButton: {
      defaultProps: {
        disableElevation: true,
      },
      styleOverrides: {
        root: {
          // Fields/buttons 8px; pill CTAs opt in per-button via sx (borderRadius: 9999).
          borderRadius: tokens.radius.field,
          fontWeight: 600,
          transition: 'transform 0.08s ease, background-color 0.2s ease, box-shadow 0.2s ease',
          '&:active': {
            transform: 'scale(0.97)',
          },
        },
        containedPrimary: {
          backgroundColor: tokens.accent,
          '&:hover': { backgroundColor: tokens.accentHover },
        },
      },
    },

    MuiPaper: {
      styleOverrides: {
        rounded: {
          borderRadius: tokens.radius.card,
        },
      },
    },

    //Table Style
    MuiTableContainer: {
      styleOverrides: {
        root: {
          borderRadius: tokens.radius.card,
        },
      },
    },
    MuiTableHead: {
      styleOverrides: {
        root: {
          userSelect: 'none',
        },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        root: {
          textAlign: 'center',
          verticalAlign: 'middle',
        },
      },
    },
    MuiTableRow: {
      styleOverrides: {
        root: {
          '&.MuiTableRow-hover:hover': {
            backgroundColor: tokens.surface.rowHover,
          },
        },
      },
    },

    MuiDialog: {
      styleOverrides: {
        paper: {
          borderRadius: 18,
          boxShadow: tokens.shadow.modal,
        },
      },
    },

    // Combobox / autocomplete popup matches the design panel.
    MuiAutocomplete: {
      styleOverrides: {
        paper: {
          borderRadius: 12,
          boxShadow: tokens.shadow.panel,
        },
        option: {
          '&[aria-selected="true"]': {
            backgroundColor: tokens.surface.selected,
          },
          '&.Mui-focused': {
            backgroundColor: '#f5f5f7',
          },
        },
      },
    },

    // Stepper RTL fixes (preserved from previous theme)
    MuiStepper: {
      styleOverrides: {
        root: {
          '&.MuiStepper-horizontal': {
            '& .MuiStep-root:first-of-type .MuiStepConnector-root': {
              display: 'none',
            },
          },
        },
      },
    },
    MuiStepConnector: {
      styleOverrides: {
        root: {
          '&.MuiStepConnector-horizontal': {
            '&::before': {
              borderTop: '3px solid',
            },
          },
        },
        line: {
          borderTopWidth: 3,
        },
      },
    },
    MuiStepLabel: {
      styleOverrides: {
        root: {
          '& .MuiStepLabel-label': {
            textAlign: 'center',
          },
        },
      },
    },
  },
});

export default theme;
