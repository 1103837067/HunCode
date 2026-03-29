import type { Config } from "tailwindcss";

export default {
	content: ["./src/webview/**/*.{ts,tsx}"],
	theme: {
		extend: {
			colors: {
				border: "var(--border)",
				background: "var(--background)",
				foreground: "var(--foreground)",
				muted: "var(--muted)",
				card: "var(--card)",
				popover: "var(--popover)",
				input: "var(--input)",
				primary: "var(--primary)",
				"primary-foreground": "var(--primary-foreground)",
				secondary: "var(--secondary)",
				"secondary-foreground": "var(--secondary-foreground)",
				accent: "var(--accent)",
				"accent-foreground": "var(--accent-foreground)",
				ring: "var(--ring)",
				success: "var(--success)",
				warning: "var(--warning)",
				destructive: "var(--destructive)",
			},
			borderRadius: {
				lg: "10px",
				md: "8px",
				sm: "6px",
			},
		},
	},
	plugins: [],
} satisfies Config;
