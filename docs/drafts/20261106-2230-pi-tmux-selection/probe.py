#!/usr/bin/env python3
"""Behavioral/effectual, controlled PTY test. SGR enters the tmux client, not the pane."""
import argparse
import base64
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import time

PI = Path('/nix/store/z0whzcf3qadlbapf48whxgdq2p5l4aaw-pi-coding-agent-1.4.0/bin/pi')
TUI_TMUX = Path('/nix/store/q6kdx2xhd5c5n8gifcf6bqf58k4h3zrx-tui-tmux/bin/tui-tmux')
BWRAP = Path('/nix/store/mvj6y8k3xs35cj7kq937xi44q4hl3r93-bubblewrap-0.12.0/bin/bwrap')
TIMEOUT = 15
SIZE = (100, 30)
SELECTION_TEXT = 'Select this synthetic text'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--config', type=Path)
    parser.add_argument('--scenario', choices=['routing', 'history-resize'], default='routing')
    args = parser.parse_args()
    out = args.out.resolve()
    out.mkdir(parents=True, exist_ok=False)
    shutil.copyfile(__file__, out / 'probe.py')
    shutil.copyfile(Path(__file__).with_name('fixture.ts'), out / 'fixture.ts')
    if args.config:
        shutil.copyfile(args.config, out / 'candidate.conf')
    run = Path(tempfile.mkdtemp(prefix='pi-tmux-select.'))
    for name in ('home', 'agent', 'work'):
        (run / name).mkdir()
    shutil.copyfile(out / 'fixture.ts', run / 'fixture.ts')
    (run / 'agent/settings.json').write_text(json.dumps({'regularMouse': args.scenario == 'routing', 'cacheWarming': 'off'}))
    env = {'HOME': str(run / 'home'), 'PATH': os.environ['PATH'], 'TERM': 'xterm-256color', 'LANG': 'C.UTF-8'}
    socket = str(run / 's')
    actions = []
    result = {'pi': str(PI), 'tmux': str(TUI_TMUX), 'run': str(run), 'size': SIZE,
              'config': str(args.config), 'scenario': args.scenario, 'input': 'SGR into attached client PTY; no physical mouse or host clipboard',
              'network': 'Pi unshare-net via bubblewrap'}
    outer_socket = str(run / 'outer')

    def outer(*argv, check=True):
        return subprocess.run([str(TUI_TMUX), '-S', outer_socket, *argv], env=env,
                              capture_output=True, text=True, check=check, timeout=10).stdout

    def resize(width, height):
        outer('resize-window', '-t', 'terminal:0', '-x', str(width), '-y', str(height))

    def tm(*argv, check=True):
        return subprocess.run([str(TUI_TMUX), '-S', socket, *argv], env=env,
                              capture_output=True, text=True, check=check, timeout=10).stdout

    def pump(seconds):
        time.sleep(seconds)

    def screen(name):
        text = outer('capture-pane', '-p', '-N', '-t', 'terminal:0.0')
        (out / (name + '.txt')).write_text(text)
        (out / (name + '.ansi')).write_text(outer('capture-pane', '-p', '-e', '-N', '-t', 'terminal:0.0'))
        return text

    def wait(predicate, name):
        deadline = time.monotonic() + TIMEOUT
        while time.monotonic() < deadline:
            pump(.05)
            text = screen('current')
            if predicate(text):
                return screen(name)
            assert tm('display-message', '-p', '-t', 'test:0.0', '#{pane_dead}').strip() != '1', text
        raise AssertionError('timeout ' + name + '\n' + text)

    def send(data):
        actions.append({'at': time.monotonic(), 'input': data})
        outer('send-keys', '-t', 'terminal:0.0', '-H', *[f'{byte:02x}' for byte in data.encode()])
        pump(.15)

    def mouse(button, x, y, release=False):
        send(f'\x1b[<{button};{x + 1};{y + 1}' + ('m' if release else 'M'))

    def locate(text, needle):
        found = [(line.index(needle), y) for y, line in enumerate(text.splitlines()) if needle in line]
        assert len(found) == 1, (needle, found)
        return found[0]

    def click_badge(opened):
        x, y = locate(screen('before-click'), 'Details')
        mouse(0, x, y)
        mouse(0, x, y, True)
        return wait(lambda text: ('DETAILS OPEN' in text) == opened, 'opened' if opened else 'closed')

    try:
        result['version'] = tm('-V').strip()
        tm('new-session', '-d', '-s', 'test', '-x', str(SIZE[0]), '-y', str(SIZE[1]), '-c', str(run / 'work'), 'sleep', '86400')
        for key, value in [('status', 'off'), ('mouse', 'on'), ('remain-on-exit', 'on'), ('default-terminal', 'tmux-256color'),
                           ('history-limit', '10000'), ('set-clipboard', 'external'), ('terminal-features', 'tmux-256color:clipboard')]:
            tm('set-option', '-g', key, value)
        tm('set-option', '-p', '-t', 'test:0.0', '@pi-selection-test', '1')
        if args.config:
            tm('source-file', str(out / 'candidate.conf'))
        (out / 'bindings.txt').write_text(tm('list-keys'))
        # The outer private tmux renders the client's actual copy-mode viewport.
        # Inner capture-pane -M exposes a backing grid, not that viewport.
        outer('new-session', '-d', '-s', 'terminal', '-x', str(SIZE[0]), '-y', str(SIZE[1]), 'sleep', '86400')
        outer('set-option', '-g', 'status', 'off')
        outer('set-option', '-g', 'remain-on-exit', 'on')
        outer('set-option', '-g', 'set-clipboard', 'on')
        outer('pipe-pane', '-O', '-t', 'terminal:0.0', f'cat > {out}/client.ansi')
        outer('respawn-pane', '-k', '-t', 'terminal:0.0', 'env', '-i', f'HOME={run}/home',
              f'PATH={env["PATH"]}', 'TERM=tmux-256color', 'LANG=C.UTF-8',
              str(TUI_TMUX), '-S', socket, 'attach-session', '-t', 'test')
        pump(.5)
        tm('pipe-pane', '-O', '-t', 'test:0.0', f'cat > {out}/app.ansi')
        launch = run / 'launch.sh'
        launch.write_text('printf "History fixture %s\\n" {1..80}\nexec "$@"\n')
        command = [str(PI), '--offline', '--no-session', '--no-extensions', '--no-mcp', '--no-skills',
                   '--no-context-files', '--no-prompt-templates', '--no-tools', '--no-approve',
                   '-e', str(run / 'fixture.ts'), '--provider', 'selection-fixture', '--model', 'synthetic', '--tui-mode', 'regular']
        tm('respawn-pane', '-k', '-t', 'test:0.0', str(BWRAP), '--unshare-net', '--die-with-parent', '--ro-bind', '/', '/',
           '--bind', str(run), str(run), '--dev', '/dev', '--chdir', str(run / 'work'),
           'env', '-i', f'HOME={run}/home', f'PATH={env["PATH"]}', 'TERM=tmux-256color', 'LANG=C.UTF-8',
           f'PI_CODING_AGENT_DIR={run}/agent', 'PI_TELEMETRY=0', f'FIXTURE_LOG={run}/events.jsonl',
           'bash', '--noprofile', '--norc', str(launch), *command)
        text = wait(lambda text: 'Details' in text and 'Select this synthetic text' in text, 'ready')
        result['clients'] = tm('list-clients', '-F', '#{client_width},#{client_height},#{client_termname},#{client_flags}')
        if args.scenario == 'history-resize':
            result['flags'] = tm('display-message', '-p', '-t', 'test:0.0', '#{alternate_on},#{mouse_any_flag},#{mouse_sgr_flag}').strip()
            assert result['flags'] == '0,0,0'
            result['history_before'] = int(tm('display-message', '-p', '-t', 'test:0.0', '#{history_size}'))
            assert result['history_before'] > 0
            resize(48, 18)
            wait(lambda text: tm('display-message', '-p', '-t', 'test:0.0', '#{pane_width},#{pane_height}').strip() == '48,18' and 'Details' in text, 'history-resized')
            result['history_after'] = int(tm('display-message', '-p', '-t', 'test:0.0', '#{history_size}'))
            result['erase_saved_lines'] = (out / 'app.ansi').read_bytes().count(b'\x1b[3J')
            assert result['history_after'] > 0, 'Pi erased tmux history on width resize with mouse capture off'
            raise AssertionError('baseline history-loss hypothesis not reproduced')
        send('DRAFT')
        wait(lambda text: 'DRAFT' in text, 'draft-ready')
        def origin_ready(text):
            output = (out / 'app.ansi').read_bytes()
            queries = output.count(b'\x1b[6n')
            rows = [json.loads(line) for line in (run / 'events.jsonl').read_text().splitlines()]
            replies = sum(len(re.findall(r'\x1b\[\d+;\d+R', row.get('raw', ''))) for row in rows)
            return 'Details' in text and queries > 0 and replies >= queries
        wait(origin_ready, 'origin-ready')
        result['flags'] = tm('display-message', '-p', '-t', 'test:0.0', '#{alternate_on},#{mouse_any_flag},#{mouse_sgr_flag}').strip()
        assert result['flags'] == '0,1,1', result['flags']
        click_badge(True)
        click_badge(False)
        x, y = locate(screen('before-selection'), 'Select this synthetic text')
        mouse(0, x, y)
        mouse(32, x + 6, y)
        result['in_mode_after_drag'] = tm('display-message', '-p', '-t', 'test:0.0', '#{pane_in_mode}').strip()
        screen('after-drag')
        assert result['in_mode_after_drag'] == '1', 'drag forwarded to Pi rather than tmux selection'
        mouse(32, x + len(SELECTION_TEXT), y)
        mouse(0, x + len(SELECTION_TEXT), y, True)
        wait(lambda text: 'Details' in text, 'after-selection')
        result['selected'] = tm('show-buffer')
        assert result['selected'] == SELECTION_TEXT, repr(result['selected'])
        assert tm('display-message', '-p', '-t', 'test:0.0', '#{pane_in_mode}').strip() == '0'
        click_badge(True)
        click_badge(False)
        # Keep the real press; taking over a badge drag must revoke it, not replay it.
        x, y = locate(screen('before-badge-drag'), 'Details')
        mouse(0, x, y)
        mouse(32, x + 2, y)
        assert tm('display-message', '-p', '-t', 'test:0.0', '#{pane_in_mode}').strip() == '1'
        mouse(32, x, y)
        mouse(0, x, y, True)
        assert 'DETAILS OPEN' not in screen('after-badge-drag')
        # Fault injection at the app boundary: prove no renderer-held press survives.
        release = f'\x1b[<0;{x + 1};{y + 1}m'.encode()
        actions.append({'orphan_release_app_boundary': release.hex()})
        tm('send-keys', '-t', 'test:0.0', '-H', *[f'{byte:02x}' for byte in release])
        pump(.2)
        assert 'DETAILS OPEN' not in screen('after-orphan-release'), 'orphan release activated a cancelled badge'
        click_badge(True)
        click_badge(False)
        result['badge_drag_cancelled'] = True
        clipboard = [base64.b64decode(value).decode() for value in re.findall(rb'\x1b\]52;[^;]*;([A-Za-z0-9+/=]*)', (out / 'client.ansi').read_bytes())]
        assert SELECTION_TEXT in clipboard, clipboard
        result['synthetic_osc52_payloads'] = clipboard
        assert 'DRAFT' in screen('draft-preserved')

        # Opt-in scoping: unmarked panes retain tmux's original forwarding.
        tm('set-option', '-pu', '-t', 'test:0.0', '@pi-selection-test')
        x, y = locate(screen('unmarked-before'), SELECTION_TEXT)
        mouse(0, x, y)
        mouse(32, x + 6, y)
        mouse(0, x + 6, y, True)
        assert tm('display-message', '-p', '-t', 'test:0.0', '#{pane_in_mode}').strip() == '0'
        result['unmarked_forwarding'] = True
        tm('set-option', '-p', '-t', 'test:0.0', '@pi-selection-test', '1')

        # Replacement during a held click must not activate the new registration.
        x, y = locate(screen('before-replacement'), 'Details')
        mouse(0, x, y)
        send('\x15/replace-badge\r')
        wait(lambda text: any(json.loads(line).get('registered') == 2 for line in (run / 'events.jsonl').read_text().splitlines()), 'replaced')
        assert locate(screen('replacement-geometry'), 'Details') == (x, y)
        mouse(0, x, y, True)
        assert 'DETAILS OPEN' not in screen('replacement-release')
        result['held_replacement_cancelled'] = True
        click_badge(True)
        click_badge(False)

        # Start wheel-based history selection while Pi still requests mouse reports.
        mouse(64, 10, 5)
        result['in_mode_after_wheel'] = tm('display-message', '-p', '-t', 'test:0.0', '#{pane_in_mode}').strip()
        assert result['in_mode_after_wheel'] == '1', 'wheel forwarded to Pi instead of tmux history'
        for _ in range(5):
            mouse(64, 10, 5)
        history = screen('history-visible')
        lines = [(i, line.strip()) for i, line in enumerate(history.splitlines()) if line.startswith('History fixture ') and i > 0]
        assert lines, history
        y, line = lines[-1]
        mouse(0, 0, y)
        mouse(32, len(line), y)
        mouse(0, len(line), y, True)
        result['history_selected'] = tm('show-buffer')
        assert result['history_selected'] == line, repr(result['history_selected'])
        assert tm('display-message', '-p', '-t', 'test:0.0', '#{pane_in_mode}').strip() == '0'
        click_badge(True)
        click_badge(False)

        # Width resize erases history independently (history-resize control); test gesture cancellation only here.
        x, y = locate(screen('before-resize'), 'Details')
        resize_event_offset = len((run / 'events.jsonl').read_text().splitlines())
        mouse(0, x, y)
        resize(48, 18)
        wait(lambda text: tm('display-message', '-p', '-t', 'test:0.0', '#{pane_width},#{pane_height}').strip() == '48,18' and 'Details' in text, 'resized')
        wait(origin_ready, 'resize-origin')
        x, y = locate(screen('resize-release-target'), 'Details')
        mouse(0, x, y, True)
        assert 'DETAILS OPEN' not in screen('resize-release')
        resize_events = [json.loads(row) for row in (run / 'events.jsonl').read_text().splitlines()[resize_event_offset:]]
        (out / 'resize-cancellation-events.json').write_text(json.dumps(resize_events, indent=2))
        assert any(row.get('type') == 'press' for row in resize_events)
        assert any(row.get('raw') == f'\x1b[<0;{x+1};{y+1}m' for row in resize_events)
        assert not any(row.get('type') in ('release', 'click') for row in resize_events)
        result['held_resize_cancelled'] = True
        result['history_after_width_resize'] = int(tm('display-message', '-p', '-t', 'test:0.0', '#{history_size}'))
        click_badge(True)
        click_badge(False)
        send('\x04')
        deadline = time.monotonic() + TIMEOUT
        while time.monotonic() < deadline and tm('display-message', '-p', '-t', 'test:0.0', '#{pane_dead}').strip() != '1':
            pump(.1)
        result['exit'] = tm('display-message', '-p', '-t', 'test:0.0', '#{pane_dead_status}').strip()
        assert result['exit'] == '0', result['exit']
        result['exit_flags'] = tm('display-message', '-p', '-t', 'test:0.0', '#{alternate_on},#{mouse_any_flag},#{mouse_sgr_flag}').strip()
        assert result['exit_flags'] == '0,0,0', result['exit_flags']
        events = [json.loads(line) for line in (run / 'events.jsonl').read_text().splitlines()]
        assert not any(row.get('inference') for row in events)
        assert any(row.get('shutdown') for row in events)
        result['badge_clicks'] = sum(row.get('type') == 'click' for row in events)
        result['passed'] = True
    except BaseException as error:
        result.update(passed=False, error=repr(error))
        raise
    finally:
        (out / 'actions.json').write_text(json.dumps(actions, indent=2) + '\n')
        if (run / 'events.jsonl').exists():
            shutil.copyfile(run / 'events.jsonl', out / 'events.jsonl')
        tm('kill-server', check=False)
        pump(.1)
        result['client_status'] = outer('display-message', '-p', '-t', 'terminal:0.0', '#{pane_dead_status}', check=False).strip()
        outer('kill-server', check=False)
        result['outer_server_removed'] = subprocess.run([str(TUI_TMUX), '-S', outer_socket, 'list-sessions'], env=env, capture_output=True).returncode != 0
        result['server_removed'] = subprocess.run([str(TUI_TMUX), '-S', socket, 'list-sessions'], env=env, capture_output=True).returncode != 0
        (out / 'result.json').write_text(json.dumps(result, indent=2) + '\n')
        print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
