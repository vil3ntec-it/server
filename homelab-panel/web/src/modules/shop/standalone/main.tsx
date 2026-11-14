// ساختِ جدای بخشِ «فروشگاه» — نقطهٔ آغاز (‎npm run build:shop-standalone‎ ⇒ ‎web/dist/shop-standalone/‎)
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import StandaloneApp from './StandaloneApp';
import '../../../index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <StandaloneApp />
  </StrictMode>
);
