import '@fontsource/russo-one/400.css';
import '@fontsource/rubik/400.css';
import '@fontsource/rubik/500.css';
import '@fontsource/rubik/700.css';
import './styles.css';
import { App } from './app';
import { store } from './ui/store';

// Тема до создания сцены: от неё зависят свет, небо и цвета панелей
const theme = store.get<{ theme?: string }>('settings', {}).theme;
if (theme === 'day') document.documentElement.dataset.theme = 'light';
else if (theme === 'night') document.documentElement.dataset.theme = 'dark';

new App();
