# React + TypeScript + Vite

## Planner Features

- Persistent cloud task storage with Firebase
- Google authentication
- Completed-task history
- Task archive and restore
- Search and advanced filtering
- Task lifecycle activity tracking
- Offline local caching
- Legacy data migration
- JSON backup and recovery
- Task effort estimates and manual actual-time entry
- Splittable-task session-size preferences
- Manual and deterministic generated work sessions
- Responsive planner interface

## Architecture

```text
React Planner UI
       ↓
Task State and Repository Layer
       ↓
Local Cache ↔ Firebase Firestore
       ↓
Authentication and User-Specific Data
```

## Optional Firebase synchronization

The planner remains fully usable with its existing localStorage cache when Firebase is not configured.
To enable Google sign-in and per-user Firestore synchronization:

1. Create a Firebase web app and enable Google in Authentication.
2. Create a Cloud Firestore database.
3. Copy `.env.example` to `.env.local` and fill in the public Firebase web-app values.
4. Deploy `firestore.rules` with the Firebase CLI before using synchronization in production.

Tasks are stored at `users/{userId}/tasks/{taskId}`, availability at
`users/{userId}/availability/{availabilityId}`, date overrides at
`users/{userId}/availabilityOverrides/{overrideId}`, reusable templates at
`users/{userId}/availabilityTemplates/{templateId}`, work sessions at
`users/{userId}/taskSessions/{sessionId}`, and preferences at
`users/{userId}/settings/preferences`. Do not add Firebase Admin SDK service-account credentials to
frontend environment files.

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) (or [oxc](https://oxc.rs) when used in [rolldown-vite](https://vite.dev/guide/rolldown)) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```
