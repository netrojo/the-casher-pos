// Local development wrapper for the Cafe POS Express app
const app = require('./api/index');
const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=>console.log(`Local dev server running on http://localhost:${PORT}`));
