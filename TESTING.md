# ARES-01 testing

Start the local server with `npm run dev` and open `/?test=1`. Press **I** to start the interactive mission, then press **T** to switch between normal speed and **4x** movement on foot and in the rover. The test-speed button shows the active setting. Restarting the mission restores normal speed.

Waypoints, collisions, mission actions and the clock still apply. Dust alerts and the suit check run at their normal timing. For a regular playthrough, open the visor without `test=1`, or press **T** to return to normal speed.

For local browser speech, combine the flags as `/?test=1&tts=browser`.
