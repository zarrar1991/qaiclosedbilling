/** iClosed design system tokens (light theme). Derived from the design bundle:
 *  app blue #031953, success greens, neutral lines, Plus Jakarta Sans. */
export default {
  content: ["./ui/index.html", "./ui/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0A0A0A",
        navy: { DEFAULT: "#031953", hover: "#0A2A6E", tint: "#E9EDF6" },
        teal: "#2596BE",
        canvas: "#F8FAFC",
        line: "#E5E7EB",
        field: "#E2E5EA",
        muted: "#94A3B8",
        body: "#475569",
        strong: "#334155",
        ok: { DEFAULT: "#15803D", bg: "#E7F6EE", border: "#BBE6CC" },
        danger: { DEFAULT: "#DC2626", bg: "#FEF2F2", border: "#FECACA" },
      },
      fontFamily: {
        sans: ["'Plus Jakarta Sans'", "system-ui", "sans-serif"],
        mono: ["'SF Mono'", "ui-monospace", "Menlo", "monospace"],
      },
      keyframes: {
        icPulse: {
          "0%,100%": { boxShadow: "0 0 0 0 rgba(3,25,83,.35)" },
          "50%": { boxShadow: "0 0 0 4px rgba(3,25,83,0)" },
        },
        icToastIn: {
          from: { opacity: "0", transform: "translateX(16px)" },
          to: { opacity: "1", transform: "translateX(0)" },
        },
      },
      animation: {
        icPulse: "icPulse 1s ease-in-out infinite",
        icToastIn: "icToastIn .22s ease-out",
      },
    },
  },
  plugins: [],
};
