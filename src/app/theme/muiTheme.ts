// import { createTheme } from "@mui/material/styles";
// import { heIL } from "@mui/material/locale";

// const primaryColor = "rgb(60,60,60)";
// const secondaryColor = "#455A64";
// const successColor = "#00C853";
// const errorColor = "#E53935";
// const backgroundColor = "#f8fafc";

// export const theme = createTheme(
//   {
//     direction: "rtl",
//     palette: {
//       mode: "light",
//       primary:   { main: primaryColor },
//       secondary: { main: secondaryColor },
//       success:   { main: successColor },
//       error:     { main: errorColor },
//       background:{ default: backgroundColor },
//     },
//     typography: {
//       // ייטען בפועל בלייאאוט עם next/font
//       fontFamily:
//         `"Rubik", Arial, "Segoe UI", sans-serif`,
//       fontWeightLight: 300,
//       fontWeightRegular: 400,
//       fontWeightMedium: 700,
//       fontWeightBold: 900,
//       h1: { fontWeight: 900 },
//       h2: { fontWeight: 900 },
//       h3: { fontWeight: 900 },
//       h4: { fontWeight: 700 },
//     },
//     components: {
//       // מיקום לייבל/כיוון לטפסים
//       MuiInputLabel: {
//         styleOverrides: {
//           root: {
//             transformOrigin: "right !important",
//             left: "inherit !important",
//             right: "1.75rem !important",
//             fontWeight: 400,
//           },
//           // כשהלייבל מצומצם
//           outlined: { right: "1.75rem" },
//         },
//       },
//       MuiOutlinedInput: {
//         styleOverrides: {
//           notchedOutline: { textAlign: "right" },
//         },
//       },
//       MuiTextField: {
//         defaultProps: {
//           InputLabelProps: { shrink: true },
//         },
//         styleOverrides: {
//           root: {
//             // הסתרת חצים במספרים (כרום/ספארי/אדג')
//             "& input[type=number]::-webkit-outer-spin-button": { display: "none" },
//             "& input[type=number]::-webkit-inner-spin-button": { display: "none" },
//             "& input[type=number]": { MozAppearance: "textfield" },
//           },
//         },
//       },
//       MuiFormHelperText: {
//         styleOverrides: {
//           root: { textAlign: "right", direction: "rtl" },
//         },
//       },
//       // טבלאות
//       MuiTableContainer: {
//         styleOverrides: { root: { borderRadius: "16px" } },
//       },
//       MuiTableHead: {
//         styleOverrides: { root: { userSelect: "none" } },
//       },
//       MuiTableCell: {
//         styleOverrides: {
//           root: { textAlign: "center", verticalAlign: "middle" },
//         },
//       },
//       // דיאלוג
//       MuiDialog: {
//         styleOverrides: { paper: { borderRadius: "16px" } },
//       },
//     },
//   },
//   heIL
// );
import { createTheme } from '@mui/material/styles';


const primaryColor = '#263238';
const secondaryColor = '#455A64';
const successColor = '#0097A7';
const errorColor = '#F44336';
const backgroundColor = '#f8fafc';




export const theme = createTheme({
  direction: 'rtl',
  palette: {
    primary: {
      main: primaryColor
    },
    secondary: {
      main: secondaryColor
    },
    success: {
      main: successColor,
    },
    error: {
      main: errorColor,
    },
    background: {
      default: backgroundColor,
    }
  },
  
   typography: {
    fontFamily: `var(--font-rubik), "Segoe UI", "Arial", sans-serif`, // משפחה אחת
    fontWeightLight: 300,
    fontWeightRegular: 400,
    fontWeightMedium: 700, 
    fontWeightBold: 900,
    h1: { fontWeight: 900 },
    h2: { fontWeight: 900 },
    h3: { fontWeight: 900 },
    h4: { fontWeight: 700 },


  },
  
  components: {
    MuiInputLabel: {
      styleOverrides: {
        root: {
          transformOrigin: 'right !important',
          left: 'inherit !important',
          right: '1.75rem !important',
          color: '#807D7B',
          fontWeight: 400,
          overflow: 'unset',
        },
      },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        notchedOutline: {
          textAlign: 'right',
        },
      },
    },
    
    MuiTextField: {
      styleOverrides: {
        root: {
          '& input[type=number]::-webkit-outer-spin-button': { display: 'none' },
          '& input[type=number]::-webkit-inner-spin-button': { display: 'none' },
          '& input[type=number]': {
            MozeAppearance: 'textfield',
          }
        }
      }
    },
    MuiFormHelperText: {
      styleOverrides: {
        root: {
          textAlign: 'right',
          diraction: 'rtl'
        }
      }
    },

    //Table Style
    MuiTableContainer: {
      styleOverrides: {
        root: {
          borderRadius: '16px',

        }
      }
    },
    MuiTableHead: {
      styleOverrides: {
        root: {
          userSelect: 'none'
          
        }
      }
    },
    MuiTableCell: {
      styleOverrides: {
        root: {
          textAlign: 'center', verticalAlign: 'middle'
        }
      }
    },
    MuiDialog: {
      styleOverrides: {
        paper: {
          borderRadius: '16px'
        }
      }
    },
    // Stepper RTL fixes
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
  }

});

export default theme;