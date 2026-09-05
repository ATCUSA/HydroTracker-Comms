/**
 * Quick phrases record what the operator says happened. Selecting one writes a
 * log entry and nothing else: no request is sent, no agency is notified.
 */
export interface QuickPhrase {
	id: string;
	text: string;
	group: 'operations' | 'emergency';
}

export const DEFAULT_QUICK_PHRASES: QuickPhrase[] = [
	{ id: 'qp-passed', text: 'Boat passed position', group: 'operations' },
	{ id: 'qp-disabled', text: 'Boat disabled', group: 'operations' },
	{ id: 'qp-notified', text: 'Race control notified', group: 'operations' },
	{ id: 'qp-hold', text: 'Course hold requested', group: 'operations' },
	{ id: 'qp-sweep', text: 'Sweep passed', group: 'operations' },
	{ id: 'qp-hazard', text: 'Hazard cleared', group: 'operations' },
	{ id: 'qp-ems', text: 'EMS requested', group: 'emergency' },
	{ id: 'qp-rescue', text: 'Rescue boat responding', group: 'emergency' },
	{ id: 'qp-piw', text: 'Person in water', group: 'emergency' },
	{ id: 'qp-patient', text: 'Patient contact', group: 'emergency' },
	{ id: 'qp-transport', text: 'Transport requested', group: 'emergency' },
	{ id: 'qp-resolved', text: 'Incident resolved', group: 'emergency' }
];

export const QUICK_PHRASE_DISCLAIMER =
	'Quick phrases record what you report. They do not send requests or notify any agency.';
