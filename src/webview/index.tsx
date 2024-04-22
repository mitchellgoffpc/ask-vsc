import React from 'react';
import { createRoot } from 'react-dom/client';
import { StateProvider } from './context';
import Sidebar from './components/Sidebar';

import './index.css';

let root = createRoot(document.getElementById("root") as Element);
root.render(
    <StateProvider>
        <Sidebar />
    </StateProvider>);
