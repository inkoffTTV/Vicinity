// Шрифты: только кириллица и латиница — остальные алфавиты не нужны и весят сотни КБ
import '@fontsource/russo-one/cyrillic-400.css';
import '@fontsource/russo-one/latin-400.css';
import '@fontsource/rubik/cyrillic-400.css';
import '@fontsource/rubik/latin-400.css';
import '@fontsource/rubik/cyrillic-500.css';
import '@fontsource/rubik/latin-500.css';
import '@fontsource/rubik/cyrillic-700.css';
import '@fontsource/rubik/latin-700.css';
import './styles.css';
import { App } from './app';
import { store } from './ui/store';

// Тема до создания сцены: от неё зависят свет, небо и цвета панелей
const theme = store.get<{ theme?: string }>('settings', {}).theme;
if (theme === 'day') document.documentElement.dataset.theme = 'light';
else if (theme === 'night') document.documentElement.dataset.theme = 'dark';

new App();
