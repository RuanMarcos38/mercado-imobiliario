from pathlib import Path

path = Path("tests/platform-buttons.test.ts")
text = path.read_text()
text = text.replace('const shell = read("src/components/crm/CrmWorkspaceShell.tsx");', 'const shell = source("src/components/crm/CrmWorkspaceShell.tsx");')
text = text.replace('const attendance = read("src/routes/_authenticated/atendimento.tsx");', 'const attendance = source("src/routes/_authenticated/atendimento.tsx");')
path.write_text(text)
