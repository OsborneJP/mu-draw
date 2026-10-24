// OPSIN as a line-by-line service for server/opsin.py: one systematic name per line on stdin,
// one answer per line on stdout. Run from source (no build step):
//   java -cp opsin.jar OpsinLines.java
// First line out: READY<TAB><OPSIN version>, once OPSIN has loaded its grammar.
// Then, per name: OK|WARN|FAIL<TAB><SMILES or empty><TAB><OPSIN's message or empty>.
// Tabs and line breaks inside a message become spaces, so every answer is one line.
// Nothing is written to stderr on purpose; server/opsin.py discards it anyway, because
// OPSIN's logging can quote the name.
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import uk.ac.cam.ch.wwmm.opsin.NameToStructure;
import uk.ac.cam.ch.wwmm.opsin.NameToStructureConfig;
import uk.ac.cam.ch.wwmm.opsin.OpsinResult;

public class OpsinLines {
    private static String oneLine(String text) {
        return text == null ? "" : text.replaceAll("[\\t\\r\\n]+", " ").trim();
    }

    public static void main(String[] args) throws Exception {
        NameToStructure opsin = NameToStructure.getInstance();
        NameToStructureConfig config = new NameToStructureConfig();
        // Say which part of the name OPSIN couldn't read, not just that it failed.
        config.setDetailedFailureAnalysis(true);
        PrintStream out = new PrintStream(System.out, false, StandardCharsets.UTF_8);
        out.println("READY\t" + NameToStructure.getVersion());
        out.flush();
        BufferedReader in = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8));
        String name;
        while ((name = in.readLine()) != null) {
            OpsinResult result = opsin.parseChemicalName(name, config);
            String status;
            switch (result.getStatus()) {
                case SUCCESS -> status = "OK";
                case WARNING -> status = "WARN";
                default -> status = "FAIL";
            }
            String smiles = status.equals("FAIL") ? "" : oneLine(result.getSmiles());
            String message = status.equals("OK") ? "" : oneLine(result.getMessage());
            out.println(status + "\t" + smiles + "\t" + message);
            out.flush();
        }
    }
}
