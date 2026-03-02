{{- define "tx-agent-kit.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "tx-agent-kit.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name (include "tx-agent-kit.name" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}

{{- define "tx-agent-kit.selectorLabels" -}}
app.kubernetes.io/name: {{ include "tx-agent-kit.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "tx-agent-kit.labels" -}}
{{ include "tx-agent-kit.selectorLabels" . }}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version | replace "+" "_" }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{- define "tx-agent-kit.runtimeSecretName" -}}
{{- if .Values.runtimeEnvSecretName -}}
{{- .Values.runtimeEnvSecretName | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-runtime" (include "tx-agent-kit.fullname" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}
