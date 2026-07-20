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
        surface: { DEFAULT: "#0f0f0f", raised: "#212121", border: "#303030" },
      },
    },
  },
  plugins: [],
};
