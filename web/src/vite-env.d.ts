/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Логин администратора для кнопки «Написать администратору» (по умолчанию inkoff) */
  readonly VITE_ADMIN_USERNAME?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
