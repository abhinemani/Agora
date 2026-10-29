import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        navy: { DEFAULT: "#14213D", 600: "#1D2E52", 50: "#E8ECF3" },
        maroon: { DEFAULT: "#7A1F2B", 50: "#F6EAEC" },
        rose: "#D06470",
        steel: "#8DA2C0",
        tint: "#EEF1F6",
        slate: { DEFAULT: "#5A6478" },
      },
      fontFamily: {
        sans: ['"Open Sans"', "system-ui", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "monospace"],
      },
      boxShadow: { card: "0 1px 2px rgba(20,33,61,0.06), 0 1px 1px rgba(20,33,61,0.04)" },
    },
  },
  plugins: [],
} satisfies Config;
