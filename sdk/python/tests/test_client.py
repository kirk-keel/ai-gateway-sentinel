import unittest
from unittest.mock import patch, MagicMock
import io
import json

from sentinel_ai.client import SentinelClient, SentinelError, SentinelResponse


class TestSentinelResponse(unittest.TestCase):
    def test_response_parsing_and_telemetry(self):
        data = {
            "id": "chatcmpl-123",
            "object": "chat.completion",
            "created": 1729600000,
            "model": "gpt-4o",
            "choices": [{"message": {"role": "assistant", "content": "Hello!"}}],
            "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15},
        }
        headers = {
            "x-sentinel-cost-usd": "0.000075",
            "x-sentinel-cache": "HIT",
            "x-sentinel-latency-ms": "4.5",
            "x-sentinel-trace-id": "trace-xyz-123",
            "x-sentinel-guardrails-scrubbed": "true",
            "x-sentinel-routed-model": "gpt-4o-mini",
            "x-sentinel-routing-tier": "standard",
            "x-sentinel-routing-savings-pct": "85.2",
        }

        resp = SentinelResponse(data, headers)
        self.assertEqual(resp.id, "chatcmpl-123")
        self.assertEqual(resp.model, "gpt-4o")
        self.assertEqual(resp.cost_usd, 0.000075)
        self.assertTrue(resp.cached)
        self.assertEqual(resp.latency_ms, 4.5)
        self.assertEqual(resp.trace_id, "trace-xyz-123")
        self.assertTrue(resp.scrubbed)
        self.assertEqual(resp.routed_model, "gpt-4o-mini")
        self.assertEqual(resp.routing_tier, "standard")
        self.assertEqual(resp.routing_savings_pct, 85.2)
        self.assertEqual(resp.to_dict(), data)


class TestSentinelClient(unittest.TestCase):
    def setUp(self):
        self.client = SentinelClient(
            base_url="http://localhost:8000",
            api_key="test-sentinel-api-key",
            tenant_id="tenant-alpha",
        )

    @patch("urllib.request.urlopen")
    def test_chat_completions_create(self, mock_urlopen):
        mock_resp = MagicMock()
        mock_resp.status = 200
        mock_resp.headers = {
            "x-sentinel-cost-usd": "0.000025",
            "x-sentinel-cache": "MISS",
            "x-sentinel-latency-ms": "12.3",
        }
        resp_data = {
            "id": "chatcmpl-mock",
            "model": "gpt-4o",
            "choices": [{"message": {"role": "assistant", "content": "Security verified."}}],
            "usage": {"total_tokens": 20},
        }
        mock_resp.read.return_value = json.dumps(resp_data).encode("utf-8")
        mock_urlopen.return_value.__enter__.return_value = mock_resp

        res = self.client.chat.completions.create(
            model="gpt-4o",
            messages=[{"role": "user", "content": "Check logs"}],
            temperature=0.7,
        )

        self.assertEqual(res.id, "chatcmpl-mock")
        self.assertEqual(res.cost_usd, 0.000025)
        self.assertFalse(res.cached)

    @patch("urllib.request.urlopen")
    def test_guardrails_check(self, mock_urlopen):
        mock_resp = MagicMock()
        mock_resp.status = 200
        mock_resp.headers = {}
        resp_data = {
            "allowed": True,
            "sanitizedText": "Patient [REDACTED_SSN] reported symptoms",
            "pii": {"hasPii": True, "matches": [{"type": "SSN"}]},
            "injection": {"isInjection": False, "score": 0.05},
        }
        mock_resp.read.return_value = json.dumps(resp_data).encode("utf-8")
        mock_urlopen.return_value.__enter__.return_value = mock_resp

        result = self.client.guardrails.check("Patient 123-45-6789 reported symptoms")
        self.assertTrue(result["allowed"])
        self.assertTrue(result["pii"]["hasPii"])
        self.assertIn("[REDACTED_SSN]", result["sanitizedText"])

    @patch("urllib.request.urlopen")
    def test_rules_crud(self, mock_urlopen):
        mock_resp = MagicMock()
        mock_resp.status = 201
        mock_resp.headers = {}
        rule_data = {
            "rule": {
                "id": "rule-100",
                "name": "Secret Key Mask",
                "type": "PII",
                "pattern": "secret-key-[0-9]+",
            }
        }
        mock_resp.read.return_value = json.dumps(rule_data).encode("utf-8")
        mock_urlopen.return_value.__enter__.return_value = mock_resp

        rule = self.client.rules.create(
            name="Secret Key Mask",
            rule_type="PII",
            pattern="secret-key-[0-9]+",
        )
        self.assertEqual(rule["id"], "rule-100")
        self.assertEqual(rule["name"], "Secret Key Mask")

    @patch("urllib.request.urlopen")
    def test_compliance_report(self, mock_urlopen):
        mock_resp = MagicMock()
        mock_resp.status = 200
        mock_resp.headers = {}
        report_data = {
            "reportId": "rep-abc",
            "cryptographicSeal": "sha256:fedcba",
            "totalRequests": 42,
        }
        mock_resp.read.return_value = json.dumps(report_data).encode("utf-8")
        mock_urlopen.return_value.__enter__.return_value = mock_resp

        report = self.client.compliance.get_report(format="json")
        self.assertEqual(report["reportId"], "rep-abc")
        self.assertEqual(report["cryptographicSeal"], "sha256:fedcba")


if __name__ == "__main__":
    unittest.main()
