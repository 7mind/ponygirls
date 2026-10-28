import asyncio
import base64
import contextlib
import copy
import fcntl
import getpass
import hashlib
import hmac
import json
import os
import socket
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path


BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
RECOVERY_KEY_PREFIX = bytes((0x8B, 0x01))
RECOVERY_KEY_LENGTH = 35
SECRET_STORAGE_KEY_LENGTH = 32
ED25519_SEED_LENGTH = 32
REQUEST_TIMEOUT_SECONDS = 10
AES_HMAC_SHA2 = "m.secret_storage.v1.aes-hmac-sha2"
CROSS_SIGNING_MASTER = "m.cross_signing.master"
CROSS_SIGNING_SELF_SIGNING = "m.cross_signing.self_signing"


def device_id():
    host = socket.gethostname().lower()
    clean = "".join(c if c.isalnum() or c == "-" else "-" for c in host)[:32]
    return f"agent-notify-{clean}"


def state_dir():
    base = os.environ.get("XDG_DATA_HOME") or str(Path.home() / ".local" / "share")
    return Path(base) / "agent-notify-matrix"


def _b64decode(value):
    if not isinstance(value, str):
        raise ValueError("expected a base64 string")
    return base64.b64decode(value + "=" * (-len(value) % 4))


def _b64encode(value):
    return base64.b64encode(value).decode().rstrip("=")


def decode_recovery_key(text):
    compact = "".join(text.split())
    number = 0
    for character in compact:
        digit = BASE58_ALPHABET.find(character)
        if digit < 0:
            raise ValueError("recovery key is not valid base58")
        number = number * 58 + digit
    leading_zeroes = len(compact) - len(compact.lstrip(BASE58_ALPHABET[0]))
    decoded = b"\x00" * leading_zeroes + number.to_bytes((number.bit_length() + 7) // 8, "big") if number else b"\x00" * leading_zeroes
    if len(decoded) != RECOVERY_KEY_LENGTH:
        raise ValueError(f"recovery key decodes to {len(decoded)} bytes, expected {RECOVERY_KEY_LENGTH}")
    if decoded[:2] != RECOVERY_KEY_PREFIX:
        raise ValueError("recovery key does not start with the expected 0x8b01 prefix")
    parity = 0
    for byte in decoded[:-1]:
        parity ^= byte
    if parity != decoded[-1]:
        raise ValueError("recovery key parity byte does not match")
    return decoded[2:2 + SECRET_STORAGE_KEY_LENGTH]


def _hkdf_sha256(key, info, length=64):
    prk = hmac.new(b"\x00" * 32, key, hashlib.sha256).digest()
    output = b""
    block = b""
    counter = 1
    while len(output) < length:
        block = hmac.new(prk, block + info + bytes((counter,)), hashlib.sha256).digest()
        output += block
        counter += 1
    return output[:length]


def _aes_ctr(key, iv, data):
    from Crypto.Cipher import AES
    cipher = AES.new(key, AES.MODE_CTR, initial_value=int.from_bytes(iv, "big"), nonce=b"")
    return cipher.encrypt(data)


def _secret_keys(storage_key, name):
    derived = _hkdf_sha256(storage_key, name.encode())
    return derived[:32], derived[32:]


def decrypt_secret(storage_key, name, encrypted):
    try:
        iv = _b64decode(encrypted["iv"])
        ciphertext = _b64decode(encrypted["ciphertext"])
        mac = _b64decode(encrypted["mac"])
    except (KeyError, TypeError, ValueError) as error:
        raise ValueError(f"secret {name} has malformed encrypted data: {error}")
    aes_key, mac_key = _secret_keys(storage_key, name)
    expected = hmac.new(mac_key, ciphertext, hashlib.sha256).digest()
    if not hmac.compare_digest(expected, mac):
        raise ValueError(f"secret {name} fails its MAC check; the recovery key does not unlock it")
    return _aes_ctr(aes_key, iv, ciphertext)


def _key_check_passes(storage_key, description):
    iv_text = description.get("iv")
    mac_text = description.get("mac")
    if iv_text is None or mac_text is None:
        return True
    aes_key, mac_key = _secret_keys(storage_key, "")
    ciphertext = _aes_ctr(aes_key, _b64decode(iv_text), b"\x00" * 32)
    expected = hmac.new(mac_key, ciphertext, hashlib.sha256).digest()
    return hmac.compare_digest(expected, _b64decode(mac_text))


def secret_storage_key(text, description):
    candidates = []
    try:
        candidates.append(decode_recovery_key(text))
    except ValueError:
        pass
    passphrase = description.get("passphrase")
    if isinstance(passphrase, dict) and passphrase.get("algorithm") == "m.pbkdf2":
        bits = passphrase.get("bits", 256)
        if not isinstance(bits, int) or bits <= 0 or bits % 8 != 0:
            raise ValueError("secret storage passphrase description has invalid bits")
        candidates.append(hashlib.pbkdf2_hmac(
            "sha512", text.strip().encode(), str(passphrase.get("salt", "")).encode(),
            int(passphrase.get("iterations", 0)), dklen=bits // 8,
        ))
    if not candidates:
        raise ValueError("recovery key file does not contain a valid Matrix recovery key")
    for candidate in candidates:
        if _key_check_passes(candidate, description):
            return candidate
    raise ValueError("recovery key does not match the account secret storage key (key check failed)")


def canonical_json(value):
    stripped = {key: item for key, item in value.items() if key not in ("signatures", "unsigned")}
    return json.dumps(stripped, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode()


def ed25519_public_key(seed):
    from Crypto.PublicKey import ECC
    return ECC.construct(curve="Ed25519", seed=seed).public_key().export_key(format="raw")


def ed25519_sign(seed, message):
    from Crypto.PublicKey import ECC
    from Crypto.Signature import eddsa
    return eddsa.new(ECC.construct(curve="Ed25519", seed=seed), mode="rfc8032").sign(message)


def ed25519_verify(public_key, message, signature):
    import vodozemac
    try:
        vodozemac.Ed25519PublicKey.from_base64(base64.b64encode(public_key).decode()).verify_signature(
            message, vodozemac.Ed25519Signature.from_base64(base64.b64encode(signature).decode()))
    except Exception:
        return False
    return True


def _matrix_json(homeserver, method, path, access_token, body=None):
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(
        homeserver.rstrip("/") + path, data=data, method=method,
        headers={"Authorization": f"Bearer {access_token}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
            payload = response.read()
    except urllib.error.HTTPError as error:
        detail = error.read().decode(errors="replace")
        try:
            parsed = json.loads(detail)
            detail = parsed.get("error") or parsed.get("errcode") or detail
        except ValueError:
            pass
        raise ValueError(f"Matrix {method} {path} failed with HTTP {error.code}: {detail}")
    except urllib.error.URLError as error:
        raise ValueError(f"Matrix {method} {path} failed: {error.reason}")
    if not payload:
        return {}
    result = json.loads(payload)
    if not isinstance(result, dict):
        raise ValueError(f"Matrix {method} {path} returned a non-object response")
    return result


def _single_public_key(key_object, label):
    keys = key_object.get("keys")
    if not isinstance(keys, dict) or len(keys) != 1:
        raise ValueError(f"uploaded {label} key does not carry exactly one ed25519 key")
    key_name, public_key = next(iter(keys.items()))
    if not isinstance(public_key, str):
        raise ValueError(f"uploaded {label} key has a non-string public key")
    return key_name, public_key


def verify_own_device(homeserver, user_id, device, access_token, recovery_key_text):
    quoted_user = urllib.parse.quote(user_id, safe="")

    def account_data(event_type):
        path = f"/_matrix/client/v3/user/{quoted_user}/account_data/{urllib.parse.quote(event_type, safe='')}"
        return _matrix_json(homeserver, "GET", path, access_token)

    try:
        default_key = account_data("m.secret_storage.default_key")
    except ValueError as error:
        raise ValueError(f"cannot read secret storage default key, so the recovery key cannot verify this device: {error}")
    key_id = default_key.get("key")
    if not isinstance(key_id, str) or not key_id:
        raise ValueError("account has no m.secret_storage.default_key; set up Secure Backup in Element before using a recovery key")
    description = account_data(f"m.secret_storage.key.{key_id}")
    if description.get("algorithm") != AES_HMAC_SHA2:
        raise ValueError(f"unsupported secret storage algorithm: {description.get('algorithm')!r}")
    storage_key = secret_storage_key(recovery_key_text, description)

    def secret_seed(name):
        data = account_data(name)
        encrypted = data.get("encrypted")
        if not isinstance(encrypted, dict) or key_id not in encrypted:
            raise ValueError(f"{name} is not stored under the default secret storage key")
        plaintext = decrypt_secret(storage_key, name, encrypted[key_id])
        try:
            seed = _b64decode(plaintext.decode().strip())
        except (UnicodeDecodeError, ValueError) as error:
            raise ValueError(f"stored {name} secret is not base64: {error}")
        if len(seed) != ED25519_SEED_LENGTH:
            raise ValueError(f"stored {name} secret is {len(seed)} bytes, expected an ed25519 seed")
        return seed

    master_seed = secret_seed(CROSS_SIGNING_MASTER)
    self_signing_seed = secret_seed(CROSS_SIGNING_SELF_SIGNING)
    query = _matrix_json(homeserver, "POST", "/_matrix/client/v3/keys/query", access_token,
                         {"device_keys": {user_id: []}})
    try:
        device_key = query["device_keys"][user_id][device]
        master_key = query["master_keys"][user_id]
        self_signing_key = query["self_signing_keys"][user_id]
    except (KeyError, TypeError) as error:
        raise ValueError(f"keys/query does not return this device and its cross-signing keys: {error}")
    _, master_public = _single_public_key(master_key, "master")
    _, self_signing_public = _single_public_key(self_signing_key, "self-signing")
    if ed25519_public_key(master_seed) != _b64decode(master_public):
        raise ValueError("recovery key unlocks a master key that does not match the uploaded master key")
    if ed25519_public_key(self_signing_seed) != _b64decode(self_signing_public):
        raise ValueError("recovery key unlocks a self-signing key that does not match the uploaded self-signing key")
    master_signature = None
    signatures = self_signing_key.get("signatures")
    if isinstance(signatures, dict) and isinstance(signatures.get(user_id), dict):
        master_signature = signatures[user_id].get(f"ed25519:{master_public}")
    if not isinstance(master_signature, str) or not ed25519_verify(
            _b64decode(master_public), canonical_json(self_signing_key), _b64decode(master_signature)):
        raise ValueError("uploaded self-signing key is not signed by the unlocked master key")
    signed_device = copy.deepcopy(device_key)
    device_signatures = signed_device.setdefault("signatures", {})
    own_signatures = device_signatures.setdefault(user_id, {})
    own_signatures[f"ed25519:{self_signing_public}"] = _b64encode(
        ed25519_sign(self_signing_seed, canonical_json(device_key)))
    response = _matrix_json(homeserver, "POST", "/_matrix/client/v3/keys/signatures/upload", access_token,
                            {user_id: {device: signed_device}})
    failures = response.get("failures")
    if isinstance(failures, dict):
        rejected = {user: devices for user, devices in failures.items() if devices}
        if rejected:
            raise ValueError(f"homeserver rejected the device signature upload: {json.dumps(rejected)}")
    return self_signing_public


class NioMatrixSender:
    def __init__(self, homeserver, room, sender=None, password_file=None, recovery_key_file=None):
        self.homeserver = homeserver.rstrip("/")
        self.room = room
        self.sender = sender
        self.password_file = Path(password_file) if password_file else None
        self.recovery_key_file = Path(recovery_key_file) if recovery_key_file else None

    @contextlib.contextmanager
    def _provision_lock(self):
        store = state_dir()
        store.mkdir(mode=0o700, parents=True, exist_ok=True)
        with open(store / "provision.lock", "a+") as handle:
            fcntl.flock(handle, fcntl.LOCK_EX)
            try:
                yield
            finally:
                fcntl.flock(handle, fcntl.LOCK_UN)

    def _read_secret_file(self, path, label):
        try:
            value = path.read_text().strip()
        except OSError as error:
            raise ValueError(f"cannot read {label} file: {error}")
        if not value:
            raise ValueError(f"{label} file is empty")
        return value

    def _sender_id(self):
        if self.sender:
            return self.sender
        if sys.stdin.isatty():
            return input("Matrix user ID: ")
        raise ValueError("e2ee transport is not provisioned on this host and no sender is configured, so it cannot provision automatically; set sender or run agent-notify-matrix --setup in a terminal")

    def _password(self):
        if self.password_file is not None:
            return self._read_secret_file(self.password_file, "password")
        if sys.stdin.isatty():
            try:
                password = getpass.getpass("Matrix password: ")
            except EOFError:
                raise ValueError("no password provided")
            if not password:
                raise ValueError("no password provided")
            return password
        raise ValueError("e2ee transport is not provisioned on this host and no passwordFile is configured, so it cannot provision automatically; set passwordFile or run agent-notify-matrix --setup in a terminal")

    def _cross_signed_marker(self):
        return state_dir() / "cross-signed.json"

    def _already_cross_signed(self, user_id, device):
        try:
            marker = json.loads(self._cross_signed_marker().read_text())
        except (OSError, ValueError):
            return False
        return marker.get("user_id") == user_id and marker.get("device_id") == device

    def _ensure_cross_signed(self, user_id, device, access_token):
        if self.recovery_key_file is None or self._already_cross_signed(user_id, device):
            return
        recovery_key = self._read_secret_file(self.recovery_key_file, "recovery key")
        self_signing_public = verify_own_device(self.homeserver, user_id, device, access_token, recovery_key)
        marker = self._cross_signed_marker()
        marker.write_text(json.dumps({
            "user_id": user_id,
            "device_id": device,
            "self_signing_key": self_signing_public,
        }))
        os.chmod(marker, 0o600)
        print(f"agent-notify-matrix: cross-signed device {device} from the recovery key; no Element verification needed", file=sys.stderr)

    def setup(self, password=None):
        with self._provision_lock():
            self._setup(password)

    def _setup(self, password=None):
        from nio import AsyncClient, LoginResponse
        store = state_dir()
        store.mkdir(mode=0o700, parents=True, exist_ok=True)
        sender = self._sender_id()
        if not password:
            password = self._password()
        dev = device_id()

        async def run():
            client = AsyncClient(self.homeserver, sender, device_id=dev, store_path=str(store))
            resp = await client.login(password, device_name=dev)
            if not isinstance(resp, LoginResponse):
                await client.close()
                raise ValueError(f"login failed: {resp}")
            try:
                await client.sync(timeout=15000)
                if client.should_upload_keys:
                    await client.keys_upload()
            finally:
                await client.close()
            return resp

        resp = asyncio.run(run())
        self._ensure_cross_signed(resp.user_id, resp.device_id, resp.access_token)
        session = store / "session.json"
        session.write_text(json.dumps({
            "user_id": resp.user_id,
            "device_id": resp.device_id,
            "access_token": resp.access_token,
        }))
        os.chmod(session, 0o600)
        print(f"provisioned {resp.user_id} device {resp.device_id}")
        print(f"key store: {store}")
        if self.recovery_key_file is None:
            print("verify this device in Element, or configure recoveryKeyFile to cross-sign it automatically, then send a test ping")

    def _session(self):
        try:
            state = json.loads((state_dir() / "session.json").read_text())
            return state["user_id"], state["device_id"], state["access_token"]
        except FileNotFoundError:
            self._setup()
        except (OSError, ValueError, KeyError) as error:
            raise ValueError(f"provisioned session is unreadable, run agent-notify-matrix --setup to reprovision: {error}")
        try:
            state = json.loads((state_dir() / "session.json").read_text())
            return state["user_id"], state["device_id"], state["access_token"]
        except (OSError, ValueError, KeyError) as error:
            raise ValueError(f"provisioning did not produce a readable session: {error}")

    def send(self, body):
        with self._provision_lock():
            user_id, dev, token = self._session()
            self._ensure_cross_signed(user_id, dev, token)
        from nio import AsyncClient

        async def run():
            store = str(state_dir())
            client = AsyncClient(self.homeserver, store_path=store)
            client.restore_login(user_id, dev, token)
            await client.sync(timeout=15000)
            if client.should_upload_keys:
                await client.keys_upload()
            await client.room_send(
                self.room,
                "m.room.message",
                {"msgtype": "m.text", "body": body},
                ignore_unverified_devices=True,
            )
            await client.close()

        asyncio.run(run())
