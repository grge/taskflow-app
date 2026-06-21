import { mount } from 'svelte';
import App from './App.svelte';
import './styles/themes.css';
import './styles/main.css';

const app = mount(App, { target: document.getElementById('app') });

export default app;
