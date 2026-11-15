<script lang="ts">
	const icons = {
		plus: 'M5 12h14 M12 5v14',
		minus: 'M5 12h14',
		flashlight: 'M8 3h8v4l-2 4v9h-4v-9L8 7V3Z M8 7h8 M12 13v2',
		mic: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z M6 11v1a6 6 0 0 0 12 0v-1 M12 18v3 M9 21h6',
		settings: 'M4 7h6m4 0h6M4 17h10m4 0h2 M10 5v4h4V5Z M14 15v4h4v-4Z',
		exit: 'M12 4H5v16h7 M9 12h11 M16 8l4 4-4 4',
		mission: 'M7 5h10a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z M9 3h6v4H9Z M9 12h6 M9 16h6',
		action: 'M5 12h14 M13 6l6 6-6 6'
	};
	let { name }: { name: keyof typeof icons } = $props();
</script>

<svg class="visor-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
	stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
	<path d={icons[name]} />
</svg>
