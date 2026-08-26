# Localization

This guide explains how to create and manage content for multiple languages in Spark.

## Supported Languages

Spark currently supports:

| Language | Code | URL Path |
|----------|------|----------|
| English | `en` | `/en/...` |
| Japanese | `ja` | `/ja/...` |

## How Localization Works

### URL-Based Locale

Each language has its own URL path prefix:

| Language | Example URL |
|----------|-------------|
| English | `frescopamedia.com/en/help/faq` |
| Japanese | `frescopamedia.com/ja/help/faq` |

### Content Structure

Content for each language lives in separate folders in Document Authoring:

```
/
├── en/
│   ├── index
│   ├── help/
│   │   ├── faq
│   │   └── meet-the-team
│   └── ...
├── ja/
│   ├── index
│   ├── help/
│   │   ├── faq
│   │   └── meet-the-team
│   └── ...
└── (shared resources)
```

## Creating Localized Content

### Option 1: Copy and Translate

1. Navigate to the source language folder (e.g., `/en/help/faq`)
2. Copy the page to the target language folder (e.g., `/ja/help/faq`)
3. Translate the content
4. Preview and publish

### Option 2: Create New

1. Navigate to the target language folder
2. Create a new page
3. Author content in that language
4. Preview and publish

## Best Practices

### Content Consistency

- **Mirror folder structure** - Keep the same page hierarchy across languages
- **Use same page names** - Makes navigation predictable (e.g., `/en/help/faq` and `/ja/help/faq`)
- **Update all languages** - When content changes, update all localized versions

### What to Localize

| Localize | Keep Original |
|----------|---------------|
| Body text | Image file names |
| Headings | URLs to external resources |
| Button text | Technical identifiers |
| Alt text for images | Block names (e.g., "cards", "tabs") |
| Page metadata | Fragment paths |

### Block Names

Block names are **not translated**. Always use English block names:

| Correct | Incorrect |
|---------|-----------|
| `cards` | `カード` |
| `accordion` | `アコーディオン` |
| `tabs` | `タブ` |

## Shared Resources

Some content is shared across all languages:

- **Navigation** (`/nav`) - May need locale-specific versions
- **Footer** (`/footer`) - May need locale-specific versions
- **Fragments** - Create locale-specific fragments when needed

### Locale-Specific Navigation

If you need different navigation for different languages:

1. Create `/en/nav` for English navigation
2. Create `/ja/nav` for Japanese navigation
3. Each page in that locale will use its respective navigation

## Links Between Languages

### Internal Links

When linking between pages, consider whether the link should:

1. **Stay in current locale** - Use relative paths: `/help/faq`
2. **Switch locale** - Use explicit paths: `/ja/help/faq`

The system automatically adds the locale prefix to relative paths.

### Language Switcher

Users can switch languages using the language selector in the header. Their preference is saved for future visits.

## Metadata for Localized Pages

Each localized page should have appropriate metadata:

| Metadata | English Example | Japanese Example |
|----------|-----------------|------------------|
| title | Frequently Asked Questions | よくある質問 |
| description | Find answers to common questions | 一般的な質問への回答 |

## Testing Localized Content

1. **Preview each language** - Ensure content displays correctly
2. **Test navigation** - Verify links work within each locale
3. **Check the language switcher** - Confirm switching languages works
4. **Review on mobile** - Some languages may wrap differently

## Troubleshooting

### Content Not Showing in Correct Language

1. **Check the URL** - Ensure the locale prefix is correct (`/en/` vs `/ja/`)
2. **Check folder location** - Content must be in the correct locale folder
3. **Verify page exists** - The page must exist in that locale folder

### Links Going to Wrong Language

1. **Check link paths** - Relative links inherit the current locale
2. **Use explicit paths** - For cross-locale links, include the full path with locale

### Navigation Issues

1. **Check for locale-specific nav** - May need separate nav files per locale
2. **Verify nav file location** - Should be at `/en/nav` or `/ja/nav` if locale-specific

## Tips

- Start with English content, then translate to other languages
- Keep a translation checklist for each page
- Review translations with native speakers
- Test the full user journey in each language

## Related

- [Page Structure](page-structure.md) - Setting up page metadata
- [Fragment](blocks/fragment.md) - Creating reusable localized content
- [Getting Started](getting-started.md) - Document Authoring basics
