// Chart entry point
import { ChartApp } from './app.js';
const app = new ChartApp();
app.init().catch(e => {
    console.error('Chart init failed:', e);
    const st = document.getElementById('status');
    if (st)
        st.textContent = `Error: ${e}`;
});
