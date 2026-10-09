# Translating

The web app uses a minimal "gettext-style" system: **the English text is the key**.

1. Create `apps/web/src/locales/<lang>.json`, for example `de.json`, `fr.json` or `pt-BR.json`.
2. Map English strings to translations:

   ```json
   {
     "Threads": "Threads",
     "Search or jump to…": "Suchen oder springen zu…",
     "{name} is typing…": "{name} schreibt…",
     "{n} reply": "{n} Antwort",
     "{n} replies": "{n} Antworten"
   }
   ```

3. Rebuild (`pnpm build`) or restart `pnpm dev`. The file is picked up automatically, and the browser's preferred language decides which one is used. `pt-BR` falls back to `pt`, then to English.

**Notes**

- **Missing strings** fall back to English, so partial translations are fine.
- **Keep placeholders** in braces exactly as they are: `{name}`, `{n}`, `{count}`.
- **Plurals:** keys come in pairs like `"{n} reply"` and `"{n} replies"`.
- **Finding strings:** run `grep -rhoE "t\('[^']+'" apps/web/src | sort -u`. Every UI string is wrapped in `t('…')`.
- **Server-generated text** (system messages, emails) is English for now.

Please contribute translations upstream with a pull request; see [CONTRIBUTING.md](../CONTRIBUTING.md).
