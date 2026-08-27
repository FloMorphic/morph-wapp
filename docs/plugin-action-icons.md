# Plugin action icons

Each action a plugin exposes can carry its own icon. The icon shows up in three
places in the portal: the **node palette** (the draggable action list), the
**node on the flow canvas**, and the **Extensions / Node Registry** lists.

If you don't set one, every action of your plugin falls back to the generic
plug glyph — which is why a plugin's actions can otherwise look identical.

## Supported icon library: Material Design Icons (MDI)

The portal bundles the **Material Design Icons** set offline (no network fetch —
FloMorphic runs on-prem). That is the **only** collection resolved for plugin
icons. Names from other libraries (Heroicons, Font Awesome, Lucide, …) will not
render and fall back to the default glyph.

- Browse and search icons at **https://pictogrammers.com/library/mdi/**
- ~7,600 icons — search by keyword (`database`, `email`, `cloud-upload`, …)

## How to set an action's icon

Set the icon name on the action descriptor, in the canonical Iconify form
`mdi:<icon-name>`:

```
icon: "mdi:database"      // a database action
icon: "mdi:email-outline" // a send-email action
icon: "mdi:cloud-upload"  // an upload action
```

The hyphen form `mdi-database` is also accepted and normalised to `mdi:database`.

Rules:

- Use the exact icon name as listed on the MDI site (the part after the `mdi`
  prefix), e.g. the site's `mdi-file-document` → `mdi:file-document`.
- A name that doesn't exist in MDI renders nothing; double-check spelling.
- Leave it unset to accept the default plug icon.

## What has to happen end-to-end

1. **You (plugin dev)** declare `icon: "mdi:<name>"` on the action.
2. **The backend** stores that name on the action's extension row
   (`ExtensionIcon.name`) when the plugin is imported / synced.
3. **The portal** reads that name and renders the MDI icon on the palette entry
   and on the node once the action is dropped onto a flow.

> If icons still render as the default plug after setting them, confirm step 2:
> the sync must persist `action.icon` into the extension row's `icon.name`. The
> portal can only show what the extension database stores.
