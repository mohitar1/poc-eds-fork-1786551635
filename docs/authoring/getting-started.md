# Getting Started

This guide walks you through the basics of creating content for Spark using Document Authoring.

## What is Document Authoring?

Document Authoring is a web-based content editing platform that lets you create and manage web pages using a familiar document-editing experience. Your documents automatically become web pages on the Spark site.

For comprehensive Document Authoring documentation, visit [docs.da.live](https://docs.da.live/).

## Setup

### 1. Install the Sidekick Extension

The AEM Sidekick is a browser extension that lets you preview and publish your content.

1. Install the [AEM Sidekick](https://chromewebstore.google.com/detail/aem-sidekick/ccfggkjabjahcjoljmgmklhpaccedipo) from the Chrome Web Store
2. Pin it to your browser toolbar for easy access
3. The Sidekick will appear when you're working on Spark content

### 2. Access Document Authoring

1. Go to [da.live](https://da.live/)
2. Sign in with your authorized account
3. Navigate to the Spark content folder

## Creating Your First Page

### Step 1: Create a New Document

1. In Document Authoring, navigate to the folder where you want to create your page
2. Create a new document
3. Give it a meaningful name (this becomes part of the URL)

> **Tip:** Use lowercase letters and hyphens for page names. For example: `about-us` or `contact-information`

### Step 2: Add Content

Start typing to add content. Document Authoring supports:

- **Headings** - Use heading styles (Heading 1, Heading 2, etc.)
- **Paragraphs** - Regular text becomes paragraph content
- **Lists** - Bulleted and numbered lists
- **Links** - Select text and add a hyperlink
- **Images** - Insert images directly into your document

### Step 3: Add a Block (Optional)

Blocks are special content components like cards, carousels, or accordions. To add a block:

1. Insert a table
2. In the first row, type the block name (e.g., `Cards`)
3. Add your content in the rows below

See the [Blocks Overview](blocks/README.md) for available blocks and how to use them.

### Step 4: Preview Your Page

1. Click the Sidekick icon in your browser toolbar
2. Click **Preview**
3. Your page opens in a new tab showing how it will appear on the site

### Step 5: Publish Your Page

When you're satisfied with your preview:

1. Open the Sidekick
2. Click **Publish**
3. Your content is now live on the site

## Understanding the Workflow

```
Edit → Preview → Review → Publish
```

| Stage | What Happens |
|-------|--------------|
| **Edit** | Make changes in Document Authoring |
| **Preview** | See changes on the preview environment (not public) |
| **Review** | Check your work, get approvals if needed |
| **Publish** | Content goes live on the production site |

## Key Concepts

### Pages and URLs

Your document's location and name determine its URL:

| Document Location | URL                        |
|-------------------|----------------------------|
| `/en/about` | `frescopamedia.com/en/about` |
| `/en/help/faq` | `frescopamedia.com/en/help/faq` |

### Sections

Use section breaks to divide your page into distinct areas. Each section can have its own background and styling.

To create a section break:
- Type `---` (three hyphens) on its own line, or
- Insert a horizontal line

Learn more in [Page Structure](page-structure.md).

### Metadata

Every page needs metadata for SEO and site functionality. Metadata is added using a special table at the end of your document.

Learn more in [Page Structure](page-structure.md).

## Common Tasks

### Editing an Existing Page

1. Navigate to the page in Document Authoring
2. Open the document
3. Make your changes
4. Preview to verify
5. Publish when ready

### Unpublishing a Page

1. Delete the document from Document Authoring
2. Open the Sidekick on the deleted page's URL
3. Click **Unpublish**

> **Note:** You must delete the document before unpublishing. The page will remain live until you complete both steps.

## Next Steps

- [Page Structure](page-structure.md) - Learn about sections and metadata
- [Blocks Overview](blocks/README.md) - Explore available content blocks
- [Images and Media](images-and-media.md) - Working with images

## Resources

- [Document Authoring Documentation](https://docs.da.live/)
- [AEM Edge Delivery Services](https://www.aem.live/docs/)
