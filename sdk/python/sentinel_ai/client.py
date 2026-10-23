import json
import urllib.request
import urllib.error
from typing import Dict, Any, Optional, List, Union


class SentinelError(Exception):
    def __init__(self, message: str, status_code: int = 500, payload: Optional[Dict] = None):
        super().__init__(message)
        self.status_code = status_code
        self.payload = payload


class SentinelResponse:
    def __init__(self, data: Dict[str, Any], headers: Dict[str, str]):
        self.data = data
        self.headers = headers
        self.id = data.get("id")
        self.object = data.get("object")
        self.created = data.get("created")
        self.model = data.get("model")
        self.choices = data.get("choices", [])
        self.usage = data.get("usage", {})

        # Sentinel Telemetry Headers
        self.cost_usd = float(headers["x-sentinel-cost-usd"]) if "x-sentinel-cost-usd" in headers else None
        self.cached = headers.get("x-sentinel-cache") == "HIT"
        self.latency_ms = float(headers["x-sentinel-latency-ms"]) if "x-sentinel-latency-ms" in headers else None
        self.trace_id = headers.get("x-sentinel-trace-id")
        self.scrubbed = headers.get("x-sentinel-guardrails-scrubbed") == "true"
        self.routed_model = headers.get("x-sentinel-routed-model")
        self.routing_tier = headers.get("x-sentinel-routing-tier")
        self.routing_savings_pct = (
            float(headers["x-sentinel-routing-savings-pct"])
            if "x-sentinel-routing-savings-pct" in headers
            else None
        )

    def to_dict(self) -> Dict[str, Any]:
        return self.data


class ChatCompletions:
    def __init__(self, client: "SentinelClient"):
        self.client = client

    def create(
        self,
        model: str,
        messages: List[Dict[str, str]],
        temperature: Optional[float] = None,
        max_tokens: Optional[int] = None,
        **kwargs: Any
    ) -> SentinelResponse:
        payload = {
            "model": model,
            "messages": messages,
            **kwargs,
        }
        if temperature is not None:
            payload["temperature"] = temperature
        if max_tokens is not None:
            payload["max_tokens"] = max_tokens

        data, headers = self.client._request("POST", "/v1/chat/completions", payload)
        return SentinelResponse(data, headers)


class Guardrails:
    def __init__(self, client: "SentinelClient"):
        self.client = client

    def check(self, text: str, block_on_pii: Optional[bool] = None, threshold: Optional[float] = None) -> Dict[str, Any]:
        payload: Dict[str, Any] = {"text": text}
        if block_on_pii is not None:
            payload["blockOnPii"] = block_on_pii
        if threshold is not None:
            payload["threshold"] = threshold

        data, _ = self.client._request("POST", "/v1/guardrails/check", payload)
        return data


class Rules:
    def __init__(self, client: "SentinelClient"):
        self.client = client

    def list(self, rule_type: Optional[str] = None, enabled: Optional[bool] = None) -> List[Dict[str, Any]]:
        query_params = []
        if rule_type:
            query_params.append(f"type={rule_type}")
        if enabled is not None:
            query_params.append(f"enabled={'true' if enabled else 'false'}")
        qs = f"?{'&'.join(query_params)}" if query_params else ""

        data, _ = self.client._request("GET", f"/v1/rules{qs}")
        return data.get("data", [])

    def create(self, name: str, rule_type: str, pattern: str, **kwargs: Any) -> Dict[str, Any]:
        payload = {
            "name": name,
            "type": rule_type,
            "pattern": pattern,
            **kwargs,
        }
        data, _ = self.client._request("POST", "/v1/rules", payload)
        return data.get("rule", {})

    def delete(self, rule_id: str) -> bool:
        _, headers = self.client._request("DELETE", f"/v1/rules/{rule_id}")
        return True


class Compliance:
    def __init__(self, client: "SentinelClient"):
        self.client = client

    def get_report(self, format: str = "json") -> Union[Dict[str, Any], str]:
        data, _ = self.client._request("GET", f"/v1/compliance/report?format={format}", raw=(format == "csv"))
        return data


class Chat:
    def __init__(self, client: "SentinelClient"):
        self.completions = ChatCompletions(client)


class SentinelClient:
    def __init__(
        self,
        base_url: str = "http://localhost:8000",
        api_key: Optional[str] = None,
        tenant_id: str = "default",
        timeout: float = 30.0,
    ):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.tenant_id = tenant_id
        self.timeout = timeout

        self.chat = Chat(self)
        self.guardrails = Guardrails(self)
        self.rules = Rules(self)
        self.compliance = Compliance(self)

    def _request(
        self,
        method: str,
        path: str,
        payload: Optional[Dict[str, Any]] = None,
        raw: bool = False,
    ):
        url = f"{self.base_url}{path}"
        headers = {
            "Content-Type": "application/json",
            "X-Tenant-ID": self.tenant_id,
        }
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"

        data_bytes = json.dumps(payload).encode("utf-8") if payload is not None else None
        req = urllib.request.Request(url, data=data_bytes, headers=headers, method=method)

        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                status = resp.status
                resp_headers = {k.lower(): v for k, v in resp.headers.items()}
                body = resp.read().decode("utf-8")

                if raw:
                    return body, resp_headers

                parsed = json.loads(body) if body else {}
                return parsed, resp_headers
        except urllib.error.HTTPError as e:
            err_body = e.read().decode("utf-8")
            try:
                err_json = json.loads(err_body)
                msg = err_json.get("error", {}).get("message", err_body)
            except Exception:
                err_json = {}
                msg = err_body
            raise SentinelError(f"HTTP {e.code}: {msg}", status_code=e.code, payload=err_json) from e
        except Exception as e:
            raise SentinelError(f"Network error: {str(e)}") from e
