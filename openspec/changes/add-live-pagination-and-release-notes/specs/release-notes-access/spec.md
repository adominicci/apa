## Purpose

Define safe, readable release notes that remain available for the installed Tesina version from both the home screen and the editor.

## ADDED Requirements

### Requirement: Release notes render supported Markdown
The application SHALL render release-note headings, paragraphs, emphasis, strong text, ordered lists, unordered lists, inline code, and links as structured content instead of displaying Markdown punctuation literally.

#### Scenario: Current changelog notes open
- **WHEN** the installed version's Markdown contains headings and list items
- **THEN** the modal displays semantic headings and formatted lists
- **THEN** literal heading markers and list hyphens are not shown as body text

#### Scenario: Notes contain unsupported Markdown
- **WHEN** release notes contain syntax outside the supported subset
- **THEN** the readable text remains available without breaking the modal layout

### Requirement: Rendered Markdown is sanitized
The application SHALL treat release-note content as untrusted input, SHALL NOT execute embedded HTML or script, and SHALL allow only safe link destinations.

#### Scenario: Notes contain raw HTML or event handlers
- **WHEN** release-note Markdown includes raw HTML, scripts, styles, inline event handlers, or embedded media
- **THEN** executable and styling content is removed or rendered inert
- **THEN** no script runs and no unrequested resource loads

#### Scenario: Notes contain an unsafe link
- **WHEN** a Markdown link uses a script, data, file, or other disallowed protocol
- **THEN** the destination is not navigable
- **THEN** the link text remains readable

#### Scenario: Notes contain a safe web link
- **WHEN** a Markdown link uses an allowed HTTPS destination
- **THEN** activating it opens the destination through the application's safe external-link path

### Requirement: Post-update notes remain automatic and one-time
The application SHALL continue to show the installed update's notes automatically once after relaunch and SHALL consume only notes matching the running version.

#### Scenario: Installed update relaunches
- **WHEN** pending notes match the newly running application version
- **THEN** the release-note modal opens after startup state resolves
- **THEN** the modal uses the bundled current-version body rather than allowing the stored payload to override it
- **THEN** dismissing the automatic modal prevents it from reopening automatically during later launches

#### Scenario: Pending notes are stale
- **WHEN** stored pending notes do not match the running application version
- **THEN** they do not open automatically or replace the installed version's bundled notes

#### Scenario: Automatic notes are reopened manually
- **WHEN** the user dismisses automatically opened notes and later activates either version control
- **THEN** the version and rendered note body are the same as the automatic presentation

### Requirement: Installed-version notes remain available offline
The application SHALL bundle the installed version's release notes and SHALL make them available after automatic notes are dismissed, after local storage is cleared, and without network access.

#### Scenario: User reopens dismissed notes
- **WHEN** the user activates a version control after dismissing the automatic modal
- **THEN** the same installed version's notes open again
- **THEN** closing the manually opened modal does not remove the bundled notes

#### Scenario: Application is offline
- **WHEN** the application has no network connection and no pending notes in local storage
- **THEN** activating a version control still opens the installed version's bundled notes

### Requirement: Version controls use the installed application version
The home screen and editor status bar SHALL display the actual installed Tesina version from one shared version source and SHALL NOT embed version numbers in translation messages.

#### Scenario: Home screen is displayed
- **WHEN** application-version resolution completes
- **THEN** the home sidebar shows the installed version beside the APA edition label
- **THEN** the version is an interactive control

#### Scenario: Editor is displayed
- **WHEN** application-version resolution completes
- **THEN** the editor status bar shows the installed version beside the existing APA 7 label
- **THEN** the version is an interactive control

#### Scenario: Runtime version lookup fails
- **WHEN** the native runtime cannot provide its version
- **THEN** the shared version source uses the packaged build version
- **THEN** the version controls and bundled notes remain available

#### Scenario: Runtime and bundled versions disagree
- **WHEN** the native runtime reports a non-empty version different from the packaged bundled-note version
- **THEN** the controls show the actual runtime version
- **THEN** the application does not label the other version's bundled body as current notes
- **THEN** the modal shows a localized unavailable state instead

### Requirement: Version controls open only current notes
Activating either version control SHALL open the same modal for the currently installed version and SHALL NOT present a release-history browser.

#### Scenario: Home version is activated
- **WHEN** the user clicks or keyboard-activates the home version control
- **THEN** the modal opens with the installed version number and its notes

#### Scenario: Editor version is activated
- **WHEN** the user clicks or keyboard-activates the status-bar version control
- **THEN** the same installed-version modal opens without leaving or modifying the essay

### Requirement: Release-note access is localized and accessible
All release-note modal chrome, version-control labels, tooltips, and accessibility names SHALL follow the UI language, and the dialog and Markdown structure SHALL support keyboard and assistive-technology navigation.

#### Scenario: Keyboard user opens notes
- **WHEN** focus is on either version control and the user presses Enter or Space
- **THEN** the release-note modal opens
- **THEN** focus moves into the modal and returns to the invoking control when it closes

#### Scenario: Keyboard user navigates an open modal
- **WHEN** the user presses Tab or Shift+Tab while release notes are open
- **THEN** focus remains within the modal until it is closed
- **THEN** background application content is not exposed as interactive modal content

#### Scenario: UI language changes
- **WHEN** the UI language switches between English and Spanish
- **THEN** the modal title, close action, completion action, version-control accessible names, and tooltips use the selected UI language
- **THEN** the published release-note body is rendered without corrupting its Markdown structure
