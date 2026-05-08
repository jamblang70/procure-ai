/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Kalau mau nambahin warna khas Sadjian Dimsum bisa di sini, Rief!
        brand: '#2563eb', 
      },
    },
  },
  plugins: [],
}