/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./static/index.html",
    "./static/app.js",
    "./static/demo/**/*.html",
  ],
  theme: {
    extend: {
      colors: {
        accent: { DEFAULT: "#e50914", hover: "#f40612" },
        surface: { DEFAULT: "#141414", raised: "#1f1f1f", border: "#333333" },
      },
    },
  },
  plugins: [],
};
