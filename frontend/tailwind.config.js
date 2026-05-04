/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        tile: {
          face: "#fff7e6",
          edge: "#d4b572",
          ink: "#2a1d0d"
        },
        paper: {
          DEFAULT: "#f7f0df",
          50: "#fbf6e9",
          100: "#f7f0df",
          200: "#efe4c5",
          300: "#e6d6a8",
          dark: "#1f1408",
          accent: "#a76a2e"
        }
      },
      fontFamily: {
        hand: ['"Patrick Hand"', '"Marker Felt"', '"Comic Sans MS"', "system-ui", "sans-serif"],
        script: ['"Caveat"', '"Bradley Hand"', '"Marker Felt"', "cursive"],
        sans: ['"Patrick Hand"', '"Marker Felt"', "system-ui", "sans-serif"]
      },
      boxShadow: {
        tile: "0 2px 0 rgba(0,0,0,0.18), 0 1px 4px rgba(0,0,0,0.12)",
        sketch: "2px 3px 0 rgba(31,20,8,0.65)"
      }
    }
  },
  plugins: []
};
