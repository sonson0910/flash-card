"""Comparison boards for the supplemental auth and file workflow states."""

WORKFLOWS = [
    ('auth', 'Auth and session recovery', [
        ('signin', 'Sign in'), ('signup', 'Sign up'),
        ('verify', 'Check email'), ('verify-success', 'Verified'),
        ('verify-expired', 'Expired link'), ('verify-already', 'Already verified'),
        ('reset', 'Reset password'), ('reset-request', 'Request reset'),
        ('reset-form', 'New password'), ('reset-done', 'Reset complete'),
        ('complete', 'Complete profile'), ('session', 'Session expired'),
        ('security', 'Account security'), ('status', 'Loading and error'),
        ('email-not-verified', 'Email not verified'),
        ('captcha-failed', 'Captcha failed'),
        ('rate-limited', 'Rate limited'),
        ('age-restricted', 'Age restricted'),
        ('unauthenticated', 'Sign-in required'),
    ], [('AuthStates', 'Classic'), ('AnimeAuthStates', 'Crystal')]),
    ('files', 'Source upload and My Files', [
        ('select', 'Select source'), ('validating', 'Check source'),
        ('rejected', 'Rejected source'), ('quota-exceeded', 'Storage limit'),
        ('uploading', 'Upload progress'),
        ('canceled', 'Canceled upload'), ('retry', 'Retry upload'),
        ('upload-incomplete', 'Completion incomplete'),
        ('upload-rejected', 'Upload rejected'),
        ('processing', 'Completion pending'), ('results', 'Saved result'),
        ('partial', 'Partial result'), ('files', 'My Files'),
        ('empty', 'No files'), ('file-error', 'List error'),
        ('delete', 'Confirm delete'),
    ], [('UploadStates', 'Classic'), ('AnimeUploadStates', 'Crystal')]),
]

FILE_VARIANTS = [
    ('SelectEpub', 'select', 'epub', 'type', 'Select EPUB'),
    ('SelectImage', 'select', 'image', 'type', 'Select image'),
    ('ResizeImage', 'validating', 'image', 'type', 'Resize image to WebP'),
    ('RejectSize', 'rejected', 'pdf', 'size', 'File too large'),
    ('RejectPlan', 'quota-exceeded', 'pdf', 'plan', 'Storage limit'),
    ('SavedEpub', 'results', 'epub', 'type', 'Open EPUB'),
    ('AttachImage', 'results', 'image', 'type', 'Attach image'),
]

for workflow, title, states, families in WORKFLOWS:
    group_boards = []
    for component, family in families:
        if not (SRC / f'{component}.dc.html').exists():
            continue
        prefix = f'Phase14{family}{workflow.title()}'
        for state, caption in states:
            name = f'{prefix}{"".join(part.title() for part in state.split("-"))}'
            add(name, pair(name, f'{family} · {caption}',
                           (component, f'theme="dark" state="{state}" viewport="desktop"'),
                           (component, f'theme="light" state="{state}" viewport="desktop"'),
                           1440, 900), f'{family} · {title} · {caption} · desktop dark/light')
            group_boards.append(name)
        for start in range(0, len(states), 4):
            batch = states[start:start + 4]
            name = f'{prefix}Mobile{start // 4 + 1}'
            columns = [(component, f'viewport="mobile" state="{state}"', 390, 844, caption)
                       for state, caption in batch]
            add(name, grid(name, f'{family} · {title} · mobile {start // 4 + 1}', columns),
                f'{family} · {title} · mobile dark/light')
            group_boards.append(name)
        if workflow == 'files':
            for suffix, state, kind, validation, caption in FILE_VARIANTS:
                name = f'{prefix}{suffix}'
                attrs = f'state="{state}" kind="{kind}" validation="{validation}" viewport="desktop"'
                add(name, pair(name, f'{family} · {caption}',
                               (component, f'theme="dark" {attrs}'),
                               (component, f'theme="light" {attrs}'), 1440, 900),
                    f'{family} · {title} · {caption} · desktop dark/light')
                group_boards.append(name)
            for start in range(0, len(FILE_VARIANTS), 4):
                batch = FILE_VARIANTS[start:start + 4]
                name = f'{prefix}MobileVariant{start // 4 + 1}'
                columns = [(component, f'viewport="mobile" state="{state}" kind="{kind}" validation="{validation}"',
                            390, 844, caption)
                           for _, state, kind, validation, caption in batch]
                add(name, grid(name, f'{family} · {title} · mobile variants {start // 4 + 1}', columns),
                    f'{family} · {title} · mobile variants dark/light')
                group_boards.append(name)
    if group_boards:
        PHASE14_GROUPS.append((f'phase14-{workflow}', title, group_boards))
