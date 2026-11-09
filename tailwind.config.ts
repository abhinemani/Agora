import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Agora palette, from the original Agora prototype. "navy" is the ink,
        // "maroon" the single action blue; names kept so every page follows.
        navy: { DEFAULT: "#192C48", 600: "#22385C", 50: "#EEF3FD" },
        maroon: { DEFAULT: "#315BD0", 600: "#254DB7", 50: "#EEF3FD" },
        rose: "#6F8FE6",
        steel: "#A9B6CA",
        tint: "#EEF3FD",
        page: "#F5F7FB",
        line: "#E1E7F1",
        slate: { DEFAULT: "#708097" },
        green: { DEFAULT: "#167757", 50: "#E7F5EF" },
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "-apple-system", '"Segoe UI"', "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "monospace"],
      },
      boxShadow: { card: "0 1px 2px rgba(20,33,61,0.06), 0 1px 1px rgba(20,33,61,0.04)" },
    },
  },
  plugins: [],
} satisfies Config;
