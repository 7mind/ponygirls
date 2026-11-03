#!/usr/bin/env python3
"""Behavioral/Effectual Good-Communication pre-exec tests; NO guest/QEMU exec.
Real qemu-img and project-owned temporary files; handwritten exec/driver/platform
sentinels exercise the actual audit and runtime entry paths without launching.
"""
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]

def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'nix/tests' / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

audit = load('manure_acceleration_audit', 'manure-vm-audit.py')
runtime = load('manure_acceleration_runtime', 'manure-vm-runtime.py')

class PlatformAccess:
    def __init__(self, kvm): self.kvm = kvm
    def access(self, path, mode):
        return self.kvm if path == '/dev/kvm' else os.access(path, mode)
    def __getattr__(self, key): return getattr(os, key)

class ExecReached(Exception): pass

class AccelerationTests(unittest.TestCase):
    def setUp(self):
        parent = ROOT / 'target/manure-vm-acceleration-tests'
        parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.temp = tempfile.TemporaryDirectory(dir=parent)
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.lab = self.base / 'lab'; self.lab.mkdir(mode=0o700)
        self.disk = self.lab / 'disk.qcow2'; audit._make_qcow2(self.disk)
        self.env = patch.dict(os.environ, {'YOLO_VM_STATE_DIR': str(self.base)})
        self.env.start(); self.addCleanup(self.env.stop)
    def argv(self, policy):
        return audit._base_argv(lab=self.lab, acceleration_policy=policy) + ['-drive', f'file={self.disk},if=none']
    def sentinel(self, *_args): raise AssertionError('real executable entry forbidden')
    def test_required_policy_api_no_default_unknown_value(self):
        with self.assertRaises(TypeError): audit.audit_argv(self.argv(audit.AccelerationPolicy.KVM_ONLY), lab=self.lab, project=None)
        for bad in [None, 'kvm-only', 'tcg', 'auto']:
            with self.subTest(policy=bad), self.assertRaises(audit.AuditError):
                audit.audit_argv(self.argv(audit.AccelerationPolicy.KVM_ONLY), lab=self.lab, project=None, acceleration_policy=bad)
    def test_actual_runtime_preflight_no_implicit_host_fallback(self):
        for accessible in [False, True]:
            with patch.object(runtime, 'os', PlatformAccess(accessible)):
                self.assertEqual(runtime.runtime_acceleration_preflight(audit, audit.AccelerationPolicy.KVM_OR_TCG), accessible)
                if accessible:
                    self.assertTrue(runtime.runtime_acceleration_preflight(audit, audit.AccelerationPolicy.KVM_ONLY))
                else:
                    with self.assertRaisesRegex(audit.AuditError, 'kvm-only requested'):
                        runtime.runtime_acceleration_preflight(audit, audit.AccelerationPolicy.KVM_ONLY)
    def test_exec_entry_success_is_policy_logged_and_sentinel_only(self):
        for policy in audit.AccelerationPolicy:
            with self.subTest(policy=policy.value):
                calls = []
                def reached(executable, argv):
                    calls.append((executable, argv)); raise ExecReached()
                with self.assertRaises(ExecReached):
                    audit._audit_exec('/sentinel-not-qemu', self.argv(policy), str(self.lab), acceleration_policy=policy, project=ROOT, exec_entry=reached)
                self.assertEqual(len(calls), 1)
                self.assertEqual(calls[0][0], '/sentinel-not-qemu')
                records = [json.loads(x) for x in (self.lab / 'audit-edge.jsonl').read_text().splitlines()]
                self.assertEqual(records[-1]['mapping']['acceleration_policy'], policy.value)
    def test_unknown_duplicate_unapproved_cpu_and_machine_never_exec(self):
        for policy in audit.AccelerationPolicy:
            base = self.argv(policy)
            variants = [base + ['-cpu', 'max'], base + ['-machine', 'accel=kvm'], base + ['-accel', 'tcg']]
            for flag, values in [('-cpu', ['host', 'max,+vmx', '']), ('-machine', ['accel=tcg', 'accel=tcg:kvm', 'accel=kvm:tcg:hvf', 'accel=kvm,accel=tcg', ''])]:
                for value in values:
                    changed = list(base); changed[changed.index(flag)+1] = value; variants.append(changed)
            for argv in variants:
                with self.subTest(policy=policy.value, argv=argv[1:]), contextlib.redirect_stderr(io.StringIO()):
                    self.assertEqual(audit._audit_exec('/sentinel-not-qemu', argv, str(self.lab), acceleration_policy=policy, project=None, exec_entry=self.sentinel), audit.AUDIT_FAIL_EXIT)
                    self.assertFalse(list(self.lab.glob('audit-*.jsonl')))
    def test_existing_attachments_and_socket_net_device_rejections_in_both_policies(self):
        outside = self.base / 'outside'; outside.mkdir()
        disk = outside / 'disk.qcow2'; audit._make_qcow2(disk)
        link = self.lab / 'link.qcow2'; link.symlink_to(disk)
        sockpath = outside / 'host.socket'
        with socket.socket(socket.AF_UNIX) as sock:
            # Worktree absolute names exceed sockaddr_un's length. Bind a
            # relative leaf in the owned directory; restore cwd immediately.
            before = Path.cwd()
            try:
                os.chdir(outside); sock.bind('host.socket')
            finally:
                os.chdir(before)
            for policy in audit.AccelerationPolicy:
                base = self.argv(policy)
                variants = [base + ['-qmp', f'unix:{sockpath},server=on'], base + ['-netdev', 'bridge,id=b0'], base + ['-netdev', 'vde,id=v0'], base + ['-device', 'vfio-pci,host=00:01.0'], base + ['-device', 'vhost-user-fs-pci,chardev=x'], base + ['-fsdev', 'local,id=x,path=/tmp'], base + ['-virtfs', 'local,path=/tmp'], base + ['-blockdev', 'driver=file,filename=/tmp/x']]
                changed = list(base); changed[-1] = f'file={link},if=none'; variants.append(changed)
                for argv in variants:
                    with self.subTest(policy=policy.value, argv=argv[1:]), contextlib.redirect_stderr(io.StringIO()):
                        self.assertEqual(audit._audit_exec('/sentinel-not-qemu', argv, str(self.lab), acceleration_policy=policy, project=None, exec_entry=self.sentinel), audit.AUDIT_FAIL_EXIT)
    def test_q35_remains_unapproved_even_with_exact_anonymous_memory_pair(self):
        pair = ['-object', 'memory-backend-memfd,id=mem0,size=1024M,share=on',
                '-machine', 'memory-backend=mem0', '-machine', 'q35,smm=on']
        for policy in audit.AccelerationPolicy:
            with self.subTest(policy=policy.value), contextlib.redirect_stderr(io.StringIO()):
                self.assertEqual(audit._audit_exec('/sentinel-not-qemu', self.argv(policy) + pair,
                    str(self.lab), acceleration_policy=policy, project=None,
                    exec_entry=self.sentinel), audit.AUDIT_FAIL_EXIT)
                self.assertFalse(list(self.lab.glob('audit-*.jsonl')))
    def test_observed_q35_complete_pair_is_the_only_new_executable_shape(self):
        pair = ['-object', 'memory-backend-memfd,id=mem0,size=1024M,share=on',
                '-machine', 'memory-backend=mem0', '-machine', 'q35,smm=on',
                '-global', 'driver=cfi.pflash01,property=secure,value=on']
        for policy in audit.AccelerationPolicy:
            calls = []
            def reached(executable, argv):
                calls.append((executable, argv)); raise ExecReached()
            with self.subTest(policy=policy.value), self.assertRaises(ExecReached):
                audit._audit_exec('/sentinel-not-qemu', self.argv(policy) + pair,
                    str(self.lab), acceleration_policy=policy, project=None, exec_entry=reached)
            self.assertEqual(len(calls), 1)
            record = json.loads((self.lab/'audit-edge.jsonl').read_text().splitlines()[-1])
            self.assertEqual(record['mapping']['machine_arguments'],
                [audit._acceleration_pattern(policy), 'memory-backend=mem0', 'q35,smm=on'])
            self.assertEqual(record['mapping']['global_arguments'],
                ['driver=cfi.pflash01,property=secure,value=on'])
    def test_cli_always_composes_real_authority_and_executable_entry(self):
        expected_project = audit._repo_root()
        calls = []
        def observe_boundary(*args, **kwargs):
            calls.append((args, kwargs)); return audit.AUDIT_FAIL_EXIT
        # Localized CLI-boundary observation only: trusted root discovery and
        # real os.execv are neither patched nor invoked as executable entries.
        with patch.object(audit, '_audit_exec', observe_boundary):
            self.assertEqual(audit.main(['audit-exec', '--acceleration-policy', 'kvm-or-tcg',
                '--lab', str(self.lab), '/sentinel-not-qemu']), audit.AUDIT_FAIL_EXIT)
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0][1]['project'], expected_project)
        self.assertIs(calls[0][1]['exec_entry'], os.execv)
        self.assertIs(calls[0][1]['acceleration_policy'], audit.AccelerationPolicy.KVM_OR_TCG)
        with self.assertRaises(TypeError):
            audit._audit_exec('/never-exec', [], str(self.lab),
                acceleration_policy=audit.AccelerationPolicy.KVM_ONLY)
    def make_driver(self, names=('edge', 'strict'), vlans=None, containers=None, backdoor=False):
        # Deliberately synthetic driver CONTROL fixture, never represented as an
        # actual generated Manure driver. The runtime subprocess is intercepted.
        qemus = sorted(Path('/nix/store').glob('*-qemu-for-vm-tests-*/bin/qemu-system-x86_64'))
        self.assertTrue(qemus, 'pinned available QEMU binary needed for identity-only stat/hash, never exec')
        real = qemus[-1]
        script = self.base / 'start.sh'
        script.write_text(f'#!/bin/sh\nexec {real} -machine accel=kvm:tcg -cpu max\n')
        test = self.base / 'test.py'; test.write_text('# controlled, never executed\n')
        config = self.base / 'config.json'
        config.write_text(json.dumps({'vlans': [] if vlans is None else vlans, 'containers': {} if containers is None else containers, 'enable_ssh_backdoor': backdoor, 'vms': {n:{'start_script':str(script)} for n in names}, 'test_script':str(test)}))
        driver = self.base / 'driver'; (driver / 'bin').mkdir(parents=True)
        wrapper = driver / 'bin/nixos-test-driver'; wrapper.write_text(f'#!/bin/sh\n# --config {config}\n'); wrapper.chmod(0o700)
        return driver, wrapper, script
    def test_runtime_wires_requested_policy_and_clears_environment_without_driver_exec(self):
        driver, wrapper, original = self.make_driver()
        captured = []
        real_run = subprocess.run
        def controlled_run(argv, **kwargs):
            if argv == ['qemu-img', '--version']: return real_run(argv, **kwargs)
            self.assertEqual(argv[0], str(wrapper)); captured.append((argv, kwargs))
            return subprocess.CompletedProcess(argv, 71)  # deliberate STOP before driver execution
        with patch.object(runtime, 'os', PlatformAccess(False)), patch.object(runtime.subprocess, 'run', controlled_run), patch.dict(os.environ, {'QEMU_OPTS':'forbidden-inherited', 'NIX_DISK_IMAGE':'forbidden-inherited'}), patch.object(sys, 'argv', ['runtime', '--acceleration-policy', 'kvm-or-tcg', str(driver)]), contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(runtime.main(), 1)
        self.assertEqual(len(captured), 1)
        argv, kw = captured[0]
        self.assertNotIn('QEMU_OPTS', kw['env']); self.assertNotIn('NIX_DISK_IMAGE', kw['env'])
        self.assertEqual(kw['env']['QEMU_NET_OPTS'], 'restrict=on')
        lab = Path(kw['cwd']); self.assertEqual(lab.stat().st_mode & 0o777, 0o700)
        manifest = json.loads((lab / 'audit-manifest.json').read_text())
        self.assertEqual(manifest['acceleration_policy'], 'kvm-or-tcg')
        for name, data in manifest['vms'].items():
            wrapper_text = Path(data['wrapper']).read_text()
            self.assertIn('--acceleration-policy kvm-or-tcg', wrapper_text)
            audited = Path(data['start_script_audited']).read_text()
            self.assertEqual(audited.replace(data['wrapper'], data['real_qemu']), original.read_text())
    def test_runtime_kvm_only_preflight_rejects_before_driver_or_lab(self):
        driver, _, _ = self.make_driver()
        def no_process(*_args, **_kwargs): raise AssertionError('preflight rejection spawned process')
        with patch.object(runtime, 'os', PlatformAccess(False)), patch.object(runtime.subprocess, 'run', no_process), patch.object(sys, 'argv', ['runtime', '--acceleration-policy', 'kvm-only', str(driver)]), contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(runtime.main(), 1)
        self.assertFalse(list(self.base.glob('manure-*')))
    def test_runtime_still_rejects_stock_or_unapproved_driver_shapes(self):
        for shape in [{'vlans':[1]}, {'containers':{'host':{}}}, {'backdoor':True}, {'names':('edge','intruder')}]:
            with self.subTest(shape=shape):
                # Each control owns a fresh fixture to avoid prior files.
                with tempfile.TemporaryDirectory(dir=self.base) as d:
                    old = self.base; self.base = Path(d)
                    try:
                        driver, _, _ = self.make_driver(**shape)
                        def no_process(*_args, **_kwargs): raise AssertionError('invalid driver spawned process')
                        with patch.object(runtime.subprocess, 'run', no_process), patch.object(sys, 'argv', ['runtime', '--acceleration-policy', 'kvm-or-tcg', str(driver)]), contextlib.redirect_stdout(io.StringIO()):
                            self.assertEqual(runtime.main(), 1)
                        self.assertFalse(list(self.base.glob('manure-*')))
                    finally: self.base = old
    def test_cli_requires_known_policy_before_any_driver_access(self):
        for module in [audit, runtime]:
            argvsets = ([['audit-exec','--lab',str(self.lab),'/never-exec'], ['audit-exec','--acceleration-policy','auto','--lab',str(self.lab),'/never-exec']] if module is audit else [['runtime','/never-driver'],['runtime','--acceleration-policy','auto','/never-driver']])
            for argv in argvsets:
                with self.subTest(module=module.__name__, argv=argv), contextlib.redirect_stderr(io.StringIO()):
                    with self.assertRaises(SystemExit) as raised:
                        if module is audit: module.main(argv)
                        else:
                            with patch.object(sys,'argv',argv): module.main()
                    self.assertEqual(raised.exception.code, 2)

if __name__ == '__main__': unittest.main(verbosity=2)
