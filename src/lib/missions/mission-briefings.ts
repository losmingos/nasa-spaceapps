export const missionBriefings = {
	ares01: {
		id: 'ARES-01',
		title: 'The Last Sample',
		briefing: [
			'Complete a sediment sampling EVA in Jezero Crater.',
			'Collect survey samples, secure the equipment, and return safely to base.'
		],
		debrief: [
			'The crew returned safely to base with three survey samples.',
			'The main core stayed at the site. The sampling log was saved.'
		]
	},
	ares02: {
		id: 'ARES-02',
		title: 'Nightfall Protocol',
		briefing: [
			'Drive the pressurized rover to Bravo Station after dark.',
			'Deliver a spare module so the station can resume drilling at 06:00.'
		],
		debrief: [
			'Bravo confirmed receipt of the spare module. The crew is safe.',
			'The module is ready for drilling at 06:00. Battery B remains isolated.'
		]
	}
} as const;
