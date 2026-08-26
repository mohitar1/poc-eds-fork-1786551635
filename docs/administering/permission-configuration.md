# Permission Configuration

Permissions for accessing the application and controlling access to assets are configured via AEM EDS sheets authored in [Spark - Document Authoring](https://da.live/#/aem-showcase/assethub-spark/config/access).

## Configuration Sheets

| Sheet | Purpose |
|-------|---------|
| `/config/access/application` | Who can access the application and what features they can use |
| `/config/access/companies` | Content access by company (email domain) |
| `/config/access/users` | Content access by individual user (email address) |
| `/config/access/restricted-brands/` | Brand-level access restrictions (one sheet per brand) |


## Application Permissions

**Sheet:** `/config/access/application`

This sheet controls who is allowed to access the application and what features they can use.

### Columns

| Column | Description |
|--------|-------------|
| `email` | Identifies who the row applies to. See matching rules below. |
| `permissions` | Comma-separated list of permissions to grant. |

### Email matching rules

The `email` column supports three formats. All matching rows are combined — a user receives permissions from their individual email match, their domain match, and the wildcard match (if present).

| Format | Example | Matches |
|--------|---------|---------|
| Email address | `user@example.com` | A specific user |
| Domain | `example.com` | All users with an `@example.com` email address |
| Wildcard | `*` | Any authenticated user |

### Permission values

| Permission | Description                                                                             |
|------------|-----------------------------------------------------------------------------------------|
| `preview` | Access to preview environments (e.g. `preview.frescopamedia.com`) and branch deployments. |
| `sudo` | Can use the impersonation / user simulation feature.                                    |
| `admin-reports` | Access to system reports.                                                               |
| `admin-rights` | Can manage rights request reviews and assign reviewers (self or others).                |
| `manage-rights` | Can manage rights request reviews (assign to self only).                                |

> **Note:** Any user authenticated by the identity provider can access the application. This sheet only controls which additional permissions they receive. Users not listed here (and not matching any domain or wildcard row) will have no special permissions but can still log in and use the application.


## Content Permissions

Content permissions determine which assets a user can see and access. They are assigned through **roles** that come from two sources:

1. **Company permissions** — matched by email domain, apply to all users at that domain.
2. **User permissions** — matched by exact email address, apply to a specific user.

Both sources are combined. If a user matches entries in both sheets, they receive the union of all roles, countries, and customers from both.

### Company Permissions

**Sheet:** `/config/access/companies`

This sheet has multiple tabs — one for each role. Each tab defines which email domains belong to that role.

#### `customer` tab

| Column | Example | Description |
|--------|---------|-------------|
| `domain` | `customer.com` | Email domain of the customer company. |
| `name` | `customerX` | Exact value used in the `custom:intendedCustomers` asset metadata field. |

#### `partner` tab

| Column | Example | Description |
|--------|---------|-------------|
| `domain` | `partner.com` | Email domain of the partner company. |
| `countries` | `us, ca, es` | Comma-separated list of countries the company has access to (2-letter ISO codes). |

#### `agency` tab

| Column | Example | Description |
|--------|---------|-------------|
| `domain` | `agency.com` | Email domain of the agency company. |

#### `employee` tab

| Column | Example | Description |
|--------|---------|-------------|
| `domain` | `company.com` | Email domain. |
| `employeeType` | `10` | Employee type from the user's Microsoft directory profile. Typically `10` for employees. If empty, this field is ignored. |

#### `contingent-worker` tab

| Column | Example | Description |
|--------|---------|-------------|
| `domain` | `company.com` | Email domain. |
| `employeeType` | `11` | Employee type from the user's Microsoft directory profile. Typically `11` for contingent workers. If empty, this field is ignored. |


### User Permissions

**Sheet:** `/config/access/users`

Use this sheet to configure individual users — either to assign roles directly or to supplement what they already receive from company permissions.

| Column | Example | Description |
|--------|---------|-------------|
| `email` | `user@example.com` | Email address of the user. |
| `roles` | `employee, partner` | Comma-separated list of roles. Optional if already set via the companies sheet. |
| `countries` | `us, ca` | Comma-separated list of partner countries (2-letter ISO codes). Optional. |
| `customers` | `customer1, customer2` | Comma-separated list of customers. Must use the exact value from the `custom:intendedCustomers` asset metadata field. |

#### Available roles

| Role | Effect on content visibility |
|------|------------------------------|
| `employee` | Can see all non-restricted content. |
| `contingent-worker` | Can see all non-restricted content. |
| `agency` | Can see all non-restricted content. |
| `partner` | Can see content filtered by their assigned countries. |
| `admin` | Can see all content, including restricted brands. |

> **Note:** If a user has no country configured in either the companies or users sheet, the country field from the identity provider (Microsoft Entra) is used.

> **Note:** A user with no roles at all will not see any content.


## Restricted Brands

Most brands are visible to all users (subject to their role-based access). However, specific brands can be marked as **restricted**. Assets tagged with a restricted brand are hidden from users unless they are explicitly granted access to that brand.

### How it works

1. An **index sheet** at `/config/access/restricted-brands-index.json` lists all restricted brands. Each entry has a `path` pointing to the brand's configuration file.

2. Each brand has its own **configuration file** at `/config/access/restricted-brands/{BrandName}.json` with three tabs:

#### `users` tab

| Column | Example | Description |
|--------|---------|-------------|
| `email` | `user@example.com` | Email address, domain, or `*` wildcard. Same matching rules as application permissions. |

#### `countries` tab

| Column | Example | Description |
|--------|---------|-------------|
| `country` | `us` | 2-letter ISO country code. Grants access to partner users from this country. |

#### `roles` tab

| Column | Example | Description |
|--------|---------|-------------|
| `role` | `employee` | Role name. Grants access to all users with this role. |

A user gains access to a restricted brand if they match **any** of the three tabs (users, countries, or roles).

Users with the `admin` role automatically have access to all brands, including restricted ones.


## Common Tasks


### Onboard a new company

1. Open `/config/access/companies` and go to the appropriate role tab (e.g. `agency`, `partner`).
2. Add a row with the company's domain and fill in the required columns for that role.
3. Publish the sheet.

### Grant admin or special permissions to a user

1. Open `/config/access/application` in Document Authoring.
2. Find or add a row with the user's email address.
3. Add the desired permissions to the `permissions` column (e.g. `sudo, admin-reports`).
4. Publish the sheet.

For the `admin` content role (see all assets), use `/config/access/users` instead and set the `roles` column to `admin`.

### Configure partner country access

For a **company** (all users at that domain):
1. Open `/config/access/companies`, go to the `partner` tab.
2. Find or add a row with the company's domain.
3. Set the `countries` column to the desired country codes (e.g. `us, ca, mx`).

For an **individual user**:
1. Open `/config/access/users`.
2. Find or add a row with the user's email.
3. Set `roles` to include `partner` (if not already set via company permissions).
4. Set the `countries` column to the desired country codes.

Publish the sheet after making changes.

### Restrict a brand

1. Create a new configuration file at `/config/access/restricted-brands/{BrandName}.json` with three tabs: `users`, `countries`, `roles`.
2. Add entries to the tabs to define who should have access to this brand.
3. Add the brand to the index at `/config/access/restricted-brands-index.json` with a `path` entry pointing to the new file.
4. Publish both files.

### Remove access for a user or company

- To revoke application access: remove their row from `/config/access/application`.
- To revoke a content role: remove their row from `/config/access/companies` or `/config/access/users`.
- To revoke restricted brand access: remove their entry from the brand's configuration file.

Publish the sheet after making changes.
