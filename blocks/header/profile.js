import { getAppLabel } from '../../scripts/locale-utils.js';
import { hasPermission, PERMISSIONS } from '../../scripts/auth/permissions.js';

/** Facet key for the Country filter (matches assetMetadata.allowedCountries). */
const ALLOWED_COUNTRIES_FACET_ID = 'allowedCountries';

// Cached placeholder function
let ph = null;

// Cached country dropdown options (fetched once per page load)
let cachedCountryOptions = null;

/**
 * Fetch the distinct countries actually tagged on assets today, via the exact same
 * facet request the search filter sidebar uses (buildFacetsArray → CATEGORY facet on
 * assetMetadata.allowedCountries), so the simulation dropdown always shows the same
 * values a user could actually filter search results by — no fixed list, no mapping.
 *
 * Uses `useRealPermissions` so this lookup reflects the real, underlying user's own
 * permissions rather than whatever country is currently being simulated — otherwise,
 * once simulating e.g. 'usa', this call would itself be scoped to 'usa'-visible
 * assets, and the dropdown could never offer any other country again.
 * @returns {Promise<{value: string, label: string}[]>} Raw facet values, sorted by label
 */
async function fetchSimulatableCountries() {
  if (cachedCountryOptions) return cachedCountryOptions;
  try {
    const { getContentAIClient } = await import('../search-results/clients/dynamicmedia-client.js');
    const response = await getContentAIClient().searchAssets('', {
      facets: [ALLOWED_COUNTRIES_FACET_ID],
      skipFacetsRequest: false,
      hitsPerPage: 0,
      // Always show every country the real, underlying user could see — not the
      // subset visible under whatever country is currently being simulated.
      useRealPermissions: true,
    });
    const facet = (response?.facets || []).find((f) => f.id === ALLOWED_COUNTRIES_FACET_ID);
    const values = facet?.values || [];

    // Dedupe case-insensitively (e.g. 'usa' and 'USA' both appearing) while keeping
    // the first-seen casing as the actual value sent to the server, since the
    // country auth filter matches exact strings. Drop empty/blank values.
    const seen = new Map();
    values.forEach(({ value }) => {
      const raw = typeof value === 'string' ? value.trim() : '';
      if (!raw) return;
      const key = raw.toLowerCase();
      if (!seen.has(key)) seen.set(key, raw);
    });

    cachedCountryOptions = [...seen.values()]
      .map((value) => ({ value, label: value }))
      .sort((a, b) => a.label.localeCompare(b.label));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[Profile] Failed to load simulatable countries:', err);
    cachedCountryOptions = [];
  }
  return cachedCountryOptions;
}

// Cookie utility functions
function setCookie(name, value, days = 365) {
  const expires = new Date();
  expires.setTime(expires.getTime() + (days * 24 * 60 * 60 * 1000));
  document.cookie = `${name}=${encodeURIComponent(value)};expires=${expires.toUTCString()};path=/`;
}

function removeCookie(name) {
  document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 UTC;path=/`;
}

async function createProfileModal() {
  // Load placeholders if not already loaded
  if (!ph) {
    ph = await getAppLabel();
  }
  const modal = document.createElement('div');
  modal.id = 'profile-modal';
  modal.className = 'profile-modal';

  // Gate on the real identity (su) while impersonating, so Reset stays available.
  const canSudo = hasPermission(window.user?.su ?? window.user, PERMISSIONS.SUDO);

  // Add sudo-mode class if user can sudo
  if (canSudo) {
    modal.classList.add('sudo-mode');
  }

  // Get current values from cookies or user object
  const currentName = window.user?.name || '';
  const currentEmail = window.user?.email || '';
  const currentCountry = window.user?.country || '';

  modal.innerHTML = `
    <div class="profile-modal-content">
      <button class="profile-modal-close" type="button">&times;</button>
      <div class="profile-header">
        <h1>${ph('myProfile', 'My Profile')}</h1>
      </div>
      <div class="profile-info">
        ${window.user?.su ? `
        <div class="profile-field">
          <label>${ph('loggedInUser', 'LOGGED IN USER')}</label>
          <div class="profile-value" id="profile-sudo">${window.user?.su?.email || ''}</div>
        </div>
         ` : ''}
         <div class="user-fields-group ${window.user?.su ? 'impersonating' : ''}">
           ${window.user?.su ? `
           <div class="simulating-title">${ph('simulatingUser', 'SIMULATING USER')}</div>
           ` : ''}
           <div class="profile-field">
             <label>${ph('name', 'NAME')}</label>
             <div class="profile-value" id="profile-name">${currentName}</div>
             ${canSudo ? `<input type="text" class="profile-input" id="profile-name-input" value="${currentName}" style="display: none;">` : ''}
           </div>
           <div class="profile-field">
             <label>${ph('email', 'EMAIL')}</label>
             <div class="profile-value" id="profile-email">${currentEmail}</div>
             ${canSudo ? `<input type="email" class="profile-input" id="profile-email-input" value="${currentEmail}" style="display: none;">` : ''}
           </div>
           <div class="profile-field">
             <label>${ph('country', 'COUNTRY')}</label>
             <div class="profile-value" id="profile-country">${currentCountry}</div>
             ${canSudo ? '<select class="profile-input" id="profile-country-input" style="display: none;"></select>' : ''}
           </div>
         </div>
         ${canSudo ? `
         <div class="sudo-edit-note" id="sudo-edit-note" style="display: none;">
           ${ph('sudoEditNote', 'Use an email from the users sheet. Country is optional — leave it blank to simulate by email only.')}
         </div>
         <div class="profile-buttons">
           <button class="edit-button" id="profile-edit-btn" type="button">
             <svg class="edit-icon" width="16" height="18" viewBox="0 0 18 21" fill="none" xmlns="http://www.w3.org/2000/svg">
               <g clip-path="url(#clip0_12408_161606)">
                 <path d="M15.3633 5.13521C13.6644 3.43633 11.4037 2.5 8.99925 2.5C6.59476 2.5 4.33558 3.43633 2.6367 5.13521C0.93633 6.83558 0 9.09625 0 11.4993C0 13.9022 0.93633 16.1629 2.6367 17.8633C4.33708 19.5637 6.59626 20.4985 9.00075 20.4985C11.4052 20.4985 13.6644 19.5622 15.3648 17.8633C17.0652 16.1629 18.0015 13.9037 18.0015 11.4993C18.0015 9.09476 17.0652 6.83558 15.3648 5.13521H15.3633Z" fill="#E4E4E4"/>
                 <path d="M4.80341 17.4797C4.57015 17.5352 4.36744 17.4769 4.19527 17.3047C4.0231 17.1326 3.96478 16.9298 4.02032 16.6966L4.68678 13.5142L7.98578 16.8132L4.80341 17.4797ZM7.98578 16.8132L4.68678 13.5142L12.3178 5.88322C12.5733 5.62774 12.8898 5.5 13.2675 5.5C13.6452 5.5 13.9617 5.62774 14.2172 5.88322L15.6168 7.28279C15.8723 7.53827 16 7.85484 16 8.2325C16 8.61016 15.8723 8.92673 15.6168 9.18221L7.98578 16.8132ZM13.2675 6.81627L6.3696 13.7142L7.78584 15.1304L14.6837 8.2325L13.2675 6.81627Z" fill="#495057"/>
               </g>
               <defs>
                 <clipPath id="clip0_edit_pencil">
                   <rect width="18" height="19.9985" fill="white" transform="translate(0 0.5)"/>
                 </clipPath>
               </defs>
             </svg>
             ${ph('simulateUser', 'Simulate User')}
           </button>
           <button class="profile-save-button" id="profile-inline-save-btn" type="button" style="display: none;">
             ${ph('save', 'Save')}
           </button>
           ${window.user?.su ? `
           <button class="reset-button" id="profile-reset-btn" type="button">
             ${ph('reset', 'Reset')}
           </button>
           ` : ''}
         </div>
         ` : ''}
      </div>
    </div>
  `;

  return modal;
}

/**
 * Populate the sudo country <select> from the "Allowed Countries" facet, so
 * simulated countries always match real, currently-tagged asset values.
 * @param {string} currentCountry - The user's current (or simulated) ISO country code
 */
async function populateCountrySelect() {
  const select = document.getElementById('profile-country-input');
  if (!select || select.dataset.populated === 'true') return;
  select.dataset.populated = 'true';

  const options = await fetchSimulatableCountries();
  select.innerHTML = '';

  // Blank default: country is optional and always starts empty, so opening the
  // form to simulate another user never carries the previous user's country over.
  const blankOption = document.createElement('option');
  blankOption.value = '';
  blankOption.textContent = ph('countryOptional', '— None (optional) —');
  select.append(blankOption);

  options.forEach(({ value, label }) => {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = label;
    select.append(opt);
  });

  select.value = '';
}

function hideProfileModal() {
  const modal = document.getElementById('profile-modal');
  if (modal) {
    modal.style.display = 'none';
    document.body.style.overflow = '';
  }
}

function toggleEditMode() {
  const modal = document.getElementById('profile-modal');
  const editBtn = document.getElementById('profile-edit-btn');
  const inlineSaveBtn = document.getElementById('profile-inline-save-btn');
  const isEditing = modal.classList.contains('editing-mode');

  if (isEditing) {
    // Switch to view mode
    modal.classList.remove('editing-mode');
    editBtn.innerHTML = `
      <svg class="edit-icon" width="16" height="18" viewBox="0 0 18 21" fill="none" xmlns="http://www.w3.org/2000/svg">
        <g clip-path="url(#clip0_12408_161606)">
          <path d="M15.3633 5.13521C13.6644 3.43633 11.4037 2.5 8.99925 2.5C6.59476 2.5 4.33558 3.43633 2.6367 5.13521C0.93633 6.83558 0 9.09625 0 11.4993C0 13.9022 0.93633 16.1629 2.6367 17.8633C4.33708 19.5637 6.59626 20.4985 9.00075 20.4985C11.4052 20.4985 13.6644 19.5622 15.3648 17.8633C17.0652 16.1629 18.0015 13.9037 18.0015 11.4993C18.0015 9.09476 17.0652 6.83558 15.3648 5.13521H15.3633Z" fill="#E4E4E4"/>
          <path d="M4.80341 17.4797C4.57015 17.5352 4.36744 17.4769 4.19527 17.3047C4.0231 17.1326 3.96478 16.9298 4.02032 16.6966L4.68678 13.5142L7.98578 16.8132L4.80341 17.4797ZM7.98578 16.8132L4.68678 13.5142L12.3178 5.88322C12.5733 5.62774 12.8898 5.5 13.2675 5.5C13.6452 5.5 13.9617 5.62774 14.2172 5.88322L15.6168 7.28279C15.8723 7.53827 16 7.85484 16 8.2325C16 8.61016 15.8723 8.92673 15.6168 9.18221L7.98578 16.8132ZM13.2675 6.81627L6.3696 13.7142L7.78584 15.1304L14.6837 8.2325L13.2675 6.81627Z" fill="#495057"/>
        </g>
        <defs>
          <clipPath id="clip0_edit_pencil_2">
            <rect width="18" height="19.9985" fill="white" transform="translate(0 0.5)"/>
          </clipPath>
        </defs>
      </svg>
${window.user?.su ? ph('simulatingUser', 'Simulating User') : ph('simulateUser', 'Simulate User')}
    `;

    // Hide sudo edit note
    const sudoEditNote = document.getElementById('sudo-edit-note');
    if (sudoEditNote) {
      sudoEditNote.style.display = 'none';
    }

    // Hide inline save button
    if (inlineSaveBtn) {
      inlineSaveBtn.style.display = 'none';
    }

    // Hide input fields, show values
    document.getElementById('profile-name').style.display = 'block';
    document.getElementById('profile-email').style.display = 'block';
    document.getElementById('profile-country').style.display = 'block';
    document.getElementById('profile-name-input').style.display = 'none';
    document.getElementById('profile-email-input').style.display = 'none';
    document.getElementById('profile-country-input').style.display = 'none';
  } else {
    // Switch to edit mode
    modal.classList.add('editing-mode');
    editBtn.innerHTML = `
      <svg class="edit-icon" width="16" height="18" viewBox="0 0 18 21" fill="none" xmlns="http://www.w3.org/2000/svg">
        <g clip-path="url(#clip0_12408_161606)">
          <path d="M15.3633 5.13521C13.6644 3.43633 11.4037 2.5 8.99925 2.5C6.59476 2.5 4.33558 3.43633 2.6367 5.13521C0.93633 6.83558 0 9.09625 0 11.4993C0 13.9022 0.93633 16.1629 2.6367 17.8633C4.33708 19.5637 6.59626 20.4985 9.00075 20.4985C11.4052 20.4985 13.6644 19.5622 15.3648 17.8633C17.0652 16.1629 18.0015 13.9037 18.0015 11.4993C18.0015 9.09476 17.0652 6.83558 15.3648 5.13521H15.3633Z" fill="#E4E4E4"/>
          <path d="M4.80341 17.4797C4.57015 17.5352 4.36744 17.4769 4.19527 17.3047C4.0231 17.1326 3.96478 16.9298 4.02032 16.6966L4.68678 13.5142L7.98578 16.8132L4.80341 17.4797ZM7.98578 16.8132L4.68678 13.5142L12.3178 5.88322C12.5733 5.62774 12.8898 5.5 13.2675 5.5C13.6452 5.5 13.9617 5.62774 14.2172 5.88322L15.6168 7.28279C15.8723 7.53827 16 7.85484 16 8.2325C16 8.61016 15.8723 8.92673 15.6168 9.18221L7.98578 16.8132ZM13.2675 6.81627L6.3696 13.7142L7.78584 15.1304L14.6837 8.2325L13.2675 6.81627Z" fill="#495057"/>
        </g>
        <defs>
          <clipPath id="clip0_edit_pencil_3">
            <rect width="18" height="19.9985" fill="white" transform="translate(0 0.5)"/>
          </clipPath>
        </defs>
      </svg>
      ${ph('cancel', 'Cancel')}
    `;

    // Show sudo edit note
    const sudoEditNote = document.getElementById('sudo-edit-note');
    if (sudoEditNote) {
      sudoEditNote.style.display = 'block';
    }

    // Show inline save button
    if (inlineSaveBtn) {
      inlineSaveBtn.style.display = 'block';
    }

    // Hide values, show input fields
    document.getElementById('profile-name').style.display = 'none';
    document.getElementById('profile-email').style.display = 'none';
    document.getElementById('profile-country').style.display = 'none';
    document.getElementById('profile-name-input').style.display = 'block';
    document.getElementById('profile-email-input').style.display = 'block';
    document.getElementById('profile-country-input').style.display = 'block';

    populateCountrySelect();
  }
}

function handleReset() {
  // Remove all SUDO_* cookies
  removeCookie('SUDO_NAME');
  removeCookie('SUDO_EMAIL');
  removeCookie('SUDO_COUNTRY');
  removeCookie('SUDO_EMPLOYEE_TYPE');

  // Reload the page
  window.location.reload();
}

function handleSave() {
  // Gate on the real identity (su) while impersonating, so Reset stays available.
  const canSudo = hasPermission(window.user?.su ?? window.user, PERMISSIONS.SUDO);

  if (canSudo) {
    // Get values from input fields
    const nameInput = document.getElementById('profile-name-input');
    const emailInput = document.getElementById('profile-email-input');
    const countryInput = document.getElementById('profile-country-input');

    if (nameInput && emailInput && countryInput) {
      setCookie('SUDO_NAME', nameInput.value);
      setCookie('SUDO_EMAIL', emailInput.value);
      // Country is optional: a blank selection removes SUDO_COUNTRY so the backend
      // falls back to the simulated user's own sheet country.
      if (countryInput.value) {
        setCookie('SUDO_COUNTRY', countryInput.value);
      } else {
        removeCookie('SUDO_COUNTRY');
      }
      window.location.reload();
    }
  }
}

export default async function showProfileModal() {
  // Create modal if it doesn't exist
  let modal = document.getElementById('profile-modal');
  if (!modal) {
    modal = await createProfileModal();
    document.body.appendChild(modal);

    // Add event listeners
    const closeBtn = modal.querySelector('.profile-modal-close');
    closeBtn.addEventListener('click', hideProfileModal);

    // Add edit button event listener (only if canSudo is true)
    const editBtn = modal.querySelector('#profile-edit-btn');
    if (editBtn) {
      editBtn.addEventListener('click', toggleEditMode);
    }

    // Add inline save button event listener
    const inlineSaveBtn = modal.querySelector('#profile-inline-save-btn');
    if (inlineSaveBtn) {
      inlineSaveBtn.addEventListener('click', handleSave);
    }

    // Add Enter key event listeners to input fields
    const nameInput = modal.querySelector('#profile-name-input');
    const emailInput = modal.querySelector('#profile-email-input');
    const countryInput = modal.querySelector('#profile-country-input');

    [nameInput, emailInput, countryInput].forEach((input) => {
      if (input) {
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            handleSave();
          }
        });
      }
    });

    // Add reset button event listener (only if window.user.su is set)
    const resetBtn = modal.querySelector('#profile-reset-btn');
    if (resetBtn) {
      resetBtn.addEventListener('click', handleReset);
    }

    // Keep original save button for other functionality (notifications, etc.)
    const saveBtn = modal.querySelector('.save-button');
    if (saveBtn) {
      saveBtn.addEventListener('click', () => {
        // Original save functionality for notifications would go here
        // Currently no additional functionality needed
      });
    }

    // Close modal when clicking outside
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        hideProfileModal();
      }
    });

    // Close modal with Escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && modal.style.display === 'flex') {
        hideProfileModal();
      }
    });
  }

  modal.style.display = 'flex';
  document.body.style.overflow = 'hidden';
}
