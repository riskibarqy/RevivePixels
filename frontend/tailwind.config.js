module.exports = {
  content: [
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extends :{
      colors: {
        'anyingCOLOR' : '#ECDFCC',
        // "secondary" : "#3C3D37",
        // "tertiary" : "#697565",
        // "quaternary" : "#ECDFCC"
      }
    },
    container: {
      center: true,
    },
    screens: {
      sm: "640px",
      md: "768px",
      lg: "1024px",
      xl: "1280px",
      "2xl": "1536px",
    },
  },
  plugins: [],
};
