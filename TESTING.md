# ARES-01 testing

Start the local server with `npm run dev` and open `/missions/ares01?test=1`. Press **I** to start the interactive mission, then press **T** to switch between normal speed and **4x** movement on foot and in the rover. The test-speed button shows the active setting. Restarting the mission restores normal speed.

Waypoints, collisions, mission actions and the clock still apply. Dust alerts and the suit check run at their normal timing. For a regular playthrough, open the visor without `test=1`, or press **T** to return to normal speed.

For local browser speech, combine the flags as `/missions/ares01?test=1&tts=browser`.

# ARES-02 testing

Open `/missions/ares02?test=1&tts=browser`. Start with **I**, turn on the headlights and drive along the curved ground guide. Check that the HUD gives routine navigation until the converter fails and traction cuts. After a successful diagnosis, follow the alternative route, check the reserve at the checkpoint and park at Bravo. After exiting, turn around to inspect the parked SEV before carrying the module to the entrance. Press **T** to accelerate travel during testing.

Repeat with **Diagnóstico no concluyente** and **Consumo elevado**. The first ends the attempt when the diagnosis completes. The second ends it when the player checks the reserve at the checkpoint. Both enter shelter mode.
