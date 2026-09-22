# PSM Next language packs

PSM Next ships only English. English is the canonical, protected fallback and cannot be replaced or removed. Additional languages are optional JSON files stored in the manager data directory under `language-packs/`.

Download the canonical template from **Settings → Language → Download English template**. It includes the generated labels and descriptions for every guided Palworld setting as well as the static strings in [`public/locales/en.json`](../public/locales/en.json). A pack may be incomplete while it is being developed; missing keys fall back to English, and Application Settings reports its coverage against the current English pack.

```json
{
  "meta": {
    "code": "fr",
    "name": "French",
    "nativeName": "Français",
    "direction": "ltr",
    "version": 1
  },
  "translations": {
    "nav.worlds": "Mondes"
  }
}
```

Rules:

- Use a lowercase ISO language code such as `fr`, or a language and uppercase region such as `pt-BR`.
- Set `direction` to `ltr` or `rtl`.
- Keep translation keys unchanged. Values must be strings.
- Preserve interpolation markers such as `{{port}}` and `{{count}}`.
- Plural forms use i18next suffixes such as `_one` and `_other`.
- Packs are limited to 512 KiB and 3,000 strings. Unsafe object-property keys are rejected.
- A custom pack cannot use the code `en`.

Install a pack from **Settings → Language → Install language pack**. The manager validates and copies it into its data directory. Selecting a language applies it immediately; restarting is not required.
