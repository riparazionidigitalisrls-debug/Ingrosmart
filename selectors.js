/**
 * DOM selectors for IngroSmart website
 * Multiple fallback selectors for each element to handle different themes/versions
 */

export const selectors = {
  // Cookie consent buttons
  cookieAccept: [
    'button#onetrust-accept-btn-handler',
    'button:has-text("Accetta tutti")',
    'button:has-text("ACCETTA")',
    'button:has-text("Accetta i cookie")',
    'button:has-text("Accept all")',
    '.cookie-consent button.accept',
    '[class*="cookie"] button[class*="accept"]',
    'button[aria-label*="accetta"]',
    '.gdpr-cookie-notice button'
  ],
  
  // Email/username input fields
  email: [
    'input[name="login[username]"]',
    'input[name="email"]',
    'input[type="email"]',
    'input#email',
    'input#username',
    'input[placeholder*="email" i]',
    'input[placeholder*="mail" i]',
    'input[autocomplete="email"]',
    'input[autocomplete="username"]',
    '.field.email input',
    '.login-form input[type="text"]'
  ],
  
  // Password input fields
  password: [
    'input[name="login[password]"]',
    'input[name="password"]',
    'input[type="password"]',
    'input#pass',
    'input#password',
    'input[placeholder*="password" i]',
    'input[autocomplete="current-password"]',
    '.field.password input',
    '.login-form input[type="password"]'
  ],
  
  // Submit/login buttons
  submit: [
    'button[type="submit"]',
    'button:has-text("Accedi")',
    'button:has-text("Login")',
    'button:has-text("Sign in")',
    'button:has-text("Entra")',
    'button.action.login',
    '.actions-toolbar button.primary',
    '#send2',
    'button.btn-login',
    'input[type="submit"]',
    '.login-form button',
    '.form-login button'
  ],
  
  // Account indicators (to verify successful login)
  accountIndicators: [
    '.customer-welcome',
    '.welcome-msg',
    '.logged-in',
    '.customer-name',
    '.header-account',
    '.account-menu',
    'a[href*="/customer/account"]',
    'a[href*="/logout"]',
    'a:has-text("Il mio account")',
    'a:has-text("My Account")',
    '[class*="customer"][class*="logged"]',
    '.authorization-link a[href*="logout"]'
  ]
};