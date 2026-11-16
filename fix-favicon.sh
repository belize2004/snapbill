mkdir -p public
# Create a tiny 1x1 favicon SVG/ICO or empty file so static assets or /favicon.ico won't trigger fallback
cat << 'SVG' > public/favicon.svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">🧾</text></svg>
SVG
